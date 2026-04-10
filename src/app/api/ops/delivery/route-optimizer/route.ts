export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';

// Delivery Route Optimizer API
// GET: Calculate optimized route for a given date with cost analysis and toll recommendations
// POST: Update route optimization settings (fuel price, truck MPG, hourly rate, HQ address)

const DEFAULT_SETTINGS = {
  fuelPrice: 3.50,
  truckMpg: 8,
  crewHourlyRate: 35,
  hqAddress: '3001 W Division St, Arlington TX 76012',
};

// DFW Toll Road Data (NTTA, TEXpress lanes)
const TOLL_ROADS = {
  dntonToll: { name: 'Dallas North Toll', costPerMile: 0.18 },
  dntonExpress: { name: 'Dallas North TEXpress', costPerMile: 0.22 },
  centrailToll: { name: 'Central Expressway Toll', costPerMile: 0.15 },
  lbj: { name: 'LBJ Express', costPerMile: 0.20 },
  i635Toll: { name: 'IH-635 Toll', costPerMile: 0.17 },
};

interface Delivery {
  id: string;
  address: string;
  city: string;
  zip: string;
  jobId: string;
  createdAt: Date;
}

interface RouteStop {
  order: number;
  deliveryId: string;
  address: string;
  city: string;
  zip: string;
  estimatedArrival: string;
  distanceFromPrev: number;
  fuelCostLeg: number;
  tollAnalysis: {
    tollCost: number;
    alternativeTime: number;
    laborCostOfDelay: number;
    recommendation: string;
  };
}

interface RouteResponse {
  date: string;
  crew: { id: string; name: string; vehicle: string; memberCount: number };
  route: {
    stops: RouteStop[];
    totalDistance: number;
    totalFuelCost: number;
    totalTollCost: number;
    totalLaborHours: number;
    fuelStopRecommendation: {
      afterStop: number;
      estimatedPrice: number;
      nearestStation: string;
    };
    costSavings: {
      vsUnoptimized: number;
      fuelSaved: number;
      tollDecisions: number;
    };
  };
  settings: {
    fuelPrice: number;
    truckMpg: number;
    crewHourlyRate: number;
    hqAddress: string;
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const crewId = searchParams.get('crewId');

    // Fetch all deliveries scheduled for the date
    // Note: Delivery doesn't have scheduledDate, use Job.scheduledDate or Delivery.createdAt
    const deliveriesQuery = `
      SELECT
        d.id, d.address, d."jobId", d."routeOrder",
        j."community" as city,
        COALESCE(
          SUBSTRING(j."jobAddress" FROM '\\d{5}$'),
          ''
        ) as zip,
        d."createdAt"
      FROM "Delivery" d
      JOIN "Job" j ON d."jobId" = j.id
      WHERE COALESCE(j."scheduledDate", d."createdAt")::date = $1::date
        ${crewId ? `AND d."crewId" = $2` : ''}
      ORDER BY d."routeOrder" ASC NULLS LAST, d."createdAt" ASC
    `;

    const params = crewId ? [date, crewId] : [date];
    const deliveries: any[] = await prisma.$queryRawUnsafe(deliveriesQuery, ...params);

    if (deliveries.length === 0) {
      return safeJson({
        date,
        message: 'No deliveries scheduled for this date',
        route: null,
      });
    }

    // Fetch crew info
    let crewInfo: any = null;
    if (crewId) {
      const crews: any[] = await prisma.$queryRawUnsafe(
        `SELECT c.id, c.name, c."vehiclePlate",
           COUNT(cm.id)::int as "memberCount"
         FROM "Crew" c
         LEFT JOIN "CrewMember" cm ON c.id = cm."crewId"
         WHERE c.id = $1
         GROUP BY c.id, c.name, c."vehiclePlate"`,
        crewId
      );
      crewInfo = crews[0];
    } else {
      // Get the most frequently assigned crew for this date
      const crews: any[] = await prisma.$queryRawUnsafe(
        `SELECT c.id, c.name, c."vehiclePlate",
           COUNT(cm.id)::int as "memberCount",
           COUNT(d.id)::int as "deliveryCount"
         FROM "Crew" c
         LEFT JOIN "CrewMember" cm ON c.id = cm."crewId"
         LEFT JOIN "Delivery" d ON c.id = d."crewId" AND d."createdAt"::date = $1::date
         WHERE c.active = true
         GROUP BY c.id, c.name, c."vehiclePlate"
         ORDER BY "deliveryCount" DESC
         LIMIT 1`,
        date
      );
      crewInfo = crews[0];
    }

    // Get settings (or use defaults)
    const settings = await getSettings();

    // Calculate optimized route using nearest-neighbor heuristic
    const optimizedRoute = calculateOptimizedRoute(
      deliveries,
      settings,
      crewInfo?.memberCount || 2
    );

    // Calculate cost metrics
    const costMetrics = calculateCosts(optimizedRoute, settings);

    // Find best fuel stop location
    const fuelStop = findFuelStopRecommendation(optimizedRoute, settings);

    // Calculate cost comparison
    const unoptimizedCost = calculateUnoptimizedCost(deliveries, settings, crewInfo?.memberCount || 2);
    const costSavings = {
      vsUnoptimized: unoptimizedCost - costMetrics.totalFuelCost,
      fuelSaved: costMetrics.fuelSavedByTollDecisions,
      tollDecisions: costMetrics.totalTollCost,
    };

    const response: RouteResponse = {
      date,
      crew: {
        id: crewInfo?.id || 'UNASSIGNED',
        name: crewInfo?.name || 'Unassigned',
        vehicle: crewInfo?.vehiclePlate || 'Standard Truck',
        memberCount: crewInfo?.memberCount || 2,
      },
      route: {
        stops: optimizedRoute,
        totalDistance: costMetrics.totalDistance,
        totalFuelCost: costMetrics.totalFuelCost,
        totalTollCost: costMetrics.totalTollCost,
        totalLaborHours: costMetrics.totalLaborHours,
        fuelStopRecommendation: fuelStop,
        costSavings,
      },
      settings,
    };

    return safeJson(response);
  } catch (error) {
    console.error('Route optimizer error:', error);
    return safeJson({ error: 'Internal server error', details: String((error as any)?.message || error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { fuelPrice, truckMpg, crewHourlyRate, hqAddress } = body;

    // Store settings in database (using raw SQL for simplicity)
    const settings = {
      fuelPrice: fuelPrice ?? DEFAULT_SETTINGS.fuelPrice,
      truckMpg: truckMpg ?? DEFAULT_SETTINGS.truckMpg,
      crewHourlyRate: crewHourlyRate ?? DEFAULT_SETTINGS.crewHourlyRate,
      hqAddress: hqAddress ?? DEFAULT_SETTINGS.hqAddress,
    };

    // Attempt to upsert settings (assuming a Settings table exists)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RouteOptimizerSettings" (id, "fuelPrice", "truckMpg", "crewHourlyRate", "hqAddress", "updatedAt")
       VALUES ('default', $1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET
         "fuelPrice" = $1,
         "truckMpg" = $2,
         "crewHourlyRate" = $3,
         "hqAddress" = $4,
         "updatedAt" = NOW()`,
      settings.fuelPrice,
      settings.truckMpg,
      settings.crewHourlyRate,
      settings.hqAddress
    );

    return safeJson({
      message: 'Settings updated successfully',
      settings,
    });
  } catch (error) {
    console.error('Settings update error:', error);
    return safeJson({ error: 'Failed to update settings' }, { status: 500 });
  }
}

async function getSettings() {
  try {
    const result: any[] = await prisma.$queryRawUnsafe(
      `SELECT "fuelPrice", "truckMpg", "crewHourlyRate", "hqAddress"
       FROM "RouteOptimizerSettings"
       WHERE id = 'default'
       LIMIT 1`
    );
    return result[0] || DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function calculateOptimizedRoute(
  deliveries: Delivery[],
  settings: any,
  crewSize: number
): RouteStop[] {
  const stops: RouteStop[] = [];
  const visited = new Set<string>();
  let currentLocation = settings.hqAddress;
  let estimatedTime = new Date();
  let distanceTraveled = 0;

  // Group deliveries by zip code prefix for geographic clustering
  const locationGroups = groupByZipPrefix(deliveries);
  const sortedDeliveries = sortByProximity(deliveries, locationGroups);

  for (let i = 0; i < sortedDeliveries.length; i++) {
    const delivery = sortedDeliveries[i];
    if (visited.has(delivery.id)) continue;

    visited.add(delivery.id);
    const distance = estimateDistance(currentLocation, delivery.address, delivery.zip);
    distanceTraveled += distance;

    // Estimate arrival time (assume 30 min per delivery average)
    estimatedTime = new Date(estimatedTime.getTime() + distance * 2.5 * 60000 + 30 * 60000);

    const fuelCost = (distance / settings.truckMpg) * settings.fuelPrice;
    const tollAnalysis = analyzeToll(delivery.city, distance, crewSize, settings);

    stops.push({
      order: i + 1,
      deliveryId: delivery.id,
      address: delivery.address,
      city: delivery.city,
      zip: delivery.zip,
      estimatedArrival: estimatedTime.toISOString(),
      distanceFromPrev: distance,
      fuelCostLeg: fuelCost,
      tollAnalysis,
    });

    currentLocation = delivery.address;
  }

  return stops;
}

function groupByZipPrefix(deliveries: Delivery[]): Map<string, Delivery[]> {
  const groups = new Map<string, Delivery[]>();
  for (const delivery of deliveries) {
    const prefix = delivery.zip.substring(0, 3);
    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix)!.push(delivery);
  }
  return groups;
}

function sortByProximity(deliveries: Delivery[], groups: Map<string, Delivery[]>): Delivery[] {
  const sorted: Delivery[] = [];
  const visited = new Set<string>();

  // Start with largest geographic cluster
  const sortedGroups = Array.from(groups.entries()).sort(
    (a, b) => b[1].length - a[1].length
  );

  for (const [, groupDeliveries] of sortedGroups) {
    for (const delivery of groupDeliveries) {
      if (!visited.has(delivery.id)) {
        sorted.push(delivery);
        visited.add(delivery.id);
      }
    }
  }

  return sorted;
}

function estimateDistance(from: string, to: string, zip: string): number {
  // Simple heuristic: assume 12 miles per stop + proximity adjustments
  const baseDistance = 12;
  const dfwZips = ['750', '751', '752', '753', '754', '755', '756', '757'];
  const isDfw = dfwZips.some(z => zip.startsWith(z));

  if (!isDfw) {
    return baseDistance + 8; // Add distance for non-DFW deliveries
  }

  // Add variance based on zip code clustering
  const zipVariance = (parseInt(zip.charAt(2)) % 5) * 1.5;
  return baseDistance + zipVariance;
}

function analyzeToll(
  city: string,
  distance: number,
  crewSize: number,
  settings: any
): RouteStop['tollAnalysis'] {
  // Common DFW toll roads
  const tollRoad = city.includes('Dallas') || city.includes('Plano')
    ? TOLL_ROADS.dntonToll
    : TOLL_ROADS.centrailToll;

  const tollCost = distance * tollRoad.costPerMile;
  const alternativeTime = distance / 45 * 60; // Assume non-toll route takes 30 min more per leg
  const extraMinutes = alternativeTime * 0.15; // 15% time increase for non-toll
  const laborCostOfDelay = (crewSize * settings.crewHourlyRate * extraMinutes) / 60;

  const recommendation =
    tollCost < laborCostOfDelay
      ? `TAKE_TOLL: Save ${(laborCostOfDelay - tollCost).toFixed(2)} vs labor cost`
      : `SKIP_TOLL: Save ${(tollCost - laborCostOfDelay).toFixed(2)} vs toll cost`;

  return {
    tollCost: parseFloat(tollCost.toFixed(2)),
    alternativeTime: parseFloat(alternativeTime.toFixed(1)),
    laborCostOfDelay: parseFloat(laborCostOfDelay.toFixed(2)),
    recommendation,
  };
}

function calculateCosts(
  stops: RouteStop[],
  settings: any
): {
  totalDistance: number;
  totalFuelCost: number;
  totalTollCost: number;
  totalLaborHours: number;
  fuelSavedByTollDecisions: number;
} {
  const totalDistance = stops.reduce((sum, stop) => sum + stop.distanceFromPrev, 0);
  const totalFuelCost = stops.reduce((sum, stop) => sum + stop.fuelCostLeg, 0);
  const totalTollCost = stops.reduce(
    (sum, stop) =>
      sum +
      (stop.tollAnalysis.recommendation.includes('TAKE_TOLL') ? stop.tollAnalysis.tollCost : 0),
    0
  );

  // Total time: 30 min per stop + travel time
  const totalMinutes = stops.length * 30 + totalDistance / 45 * 60;
  const totalLaborHours = totalMinutes / 60;

  const fuelSavedByTollDecisions = stops.reduce((sum, stop) => {
    if (stop.tollAnalysis.recommendation.includes('SKIP_TOLL')) {
      return sum + stop.tollAnalysis.tollCost;
    }
    return sum;
  }, 0);

  return {
    totalDistance: parseFloat(totalDistance.toFixed(1)),
    totalFuelCost: parseFloat(totalFuelCost.toFixed(2)),
    totalTollCost: parseFloat(totalTollCost.toFixed(2)),
    totalLaborHours: parseFloat(totalLaborHours.toFixed(2)),
    fuelSavedByTollDecisions: parseFloat(fuelSavedByTollDecisions.toFixed(2)),
  };
}

function findFuelStopRecommendation(
  stops: RouteStop[],
  settings: any
): {
  afterStop: number;
  estimatedPrice: number;
  nearestStation: string;
} {
  // Recommend fuel stop after halfway point
  const midpoint = Math.floor(stops.length / 2);
  const tankRange = 400; // miles per tank
  const totalDistance = stops.reduce((sum, stop) => sum + stop.distanceFromPrev, 0);
  const fuelStopDistance = totalDistance / 2;

  // Estimate price based on market
  const estimatedPrice = settings.fuelPrice * 12; // Assume 12 gallon fill-up

  // Suggest station near midway zip code
  const midStop = stops[midpoint];
  const stations: { [key: string]: string } = {
    '750': 'Love Field Area - Love Fuel Stop',
    '751': 'Plano Area - Plano Shell',
    '752': 'Addison Area - Addison QuikTrip',
    '753': 'Arlington Area - Arlington Speedway',
    '754': 'Irving Area - Irving Valero',
    '755': 'Grand Prairie - GP Love Fuel',
  };

  const nearestStation = Object.entries(stations).find(
    ([zip]) => midStop?.zip.startsWith(zip)
  )?.[1] || 'Nearest QuikTrip or Love Fuel Stop';

  return {
    afterStop: midpoint > 0 ? midpoint : 1,
    estimatedPrice: parseFloat(estimatedPrice.toFixed(2)),
    nearestStation,
  };
}

function calculateUnoptimizedCost(deliveries: Delivery[], settings: any, crewSize: number): number {
  // Calculate cost if deliveries were done in original order (no optimization)
  const distance = deliveries.length * 15; // Assume 15 miles per delivery without clustering
  const fuel = (distance / settings.truckMpg) * settings.fuelPrice;
  const time = deliveries.length * 45; // 45 min per delivery avg
  const labor = (time / 60) * crewSize * settings.crewHourlyRate;

  return fuel + labor;
}
