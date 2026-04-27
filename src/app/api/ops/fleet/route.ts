export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { checkStaffAuth } from '@/lib/api-auth';

const BOX_EXPORT_PATH = path.resolve(process.cwd(), '..', 'Abel Door & Trim_ DFW Box Export', 'Abel Door & Trim_ DFW');

interface Vehicle {
  year: string | null;
  make: string;
  fullName: string;
  vin: string;
}

interface Driver {
  name: string;
  dob: string | null;
  dlNumber: string | null;
}

interface FleetResponse {
  vehicles: Vehicle[];
  drivers: Driver[];
  summary: {
    totalVehicles: number;
    totalDrivers: number;
  };
}

function parseVehicleFolderName(folderName: string): Vehicle {
  // Example: "2020 Grey LGS IND 24 Ft Enclosed Trailer (Vin_ 0727)"
  // Extract year, description, and VIN

  const vinMatch = folderName.match(/\(?\s*Vin_\s*(\d{4})\)?/i);
  const vin = vinMatch ? vinMatch[1] : '';

  // Extract year from the beginning
  const yearMatch = folderName.match(/^(\d{4})/);
  const year = yearMatch ? yearMatch[1] : null;

  // Extract description (everything between year and Vin)
  let description = folderName;
  if (vinMatch) {
    // Remove the (Vin_ XXXX) part
    description = description
      .substring(0, vinMatch.index)
      .replace(/\s*\(\s*$/, '')
      .trim();
  }

  // Remove year from beginning
  if (yearMatch) {
    description = description.replace(new RegExp(`^${yearMatch[0]}\\s*`), '').trim();
  }

  return {
    year,
    make: description,
    fullName: folderName,
    vin,
  };
}

function getVehicles(): Vehicle[] {
  const trailersPath = path.join(
    BOX_EXPORT_PATH,
    'Delivery & Driver Documents/Delivery Trailers'
  );

  const vehicles: Vehicle[] = [];

  try {
    if (!fs.existsSync(trailersPath)) {
      console.warn(`Trailers directory not found: ${trailersPath}`);
      return vehicles;
    }

    const entries = fs.readdirSync(trailersPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const vehicle = parseVehicleFolderName(entry.name);
        vehicles.push(vehicle);
      }
    }
  } catch (error) {
    console.error(`Error reading vehicles directory: ${error}`);
  }

  return vehicles.sort((a, b) => {
    // Sort by year descending, then by name
    if (a.year && b.year) {
      const yearDiff = parseInt(b.year) - parseInt(a.year);
      if (yearDiff !== 0) return yearDiff;
    }
    return a.make.localeCompare(b.make);
  });
}

function getDrivers(): Driver[] {
  const driverExcelPath = path.join(
    BOX_EXPORT_PATH,
    'Warehouse/Driver Data/Abel Door & Trim - Driver Information.xlsx'
  );

  const drivers: Driver[] = [];

  try {
    if (!fs.existsSync(driverExcelPath)) {
      console.warn(`Driver Excel file not found: ${driverExcelPath}`);
      return drivers;
    }

    const workbook = XLSX.readFile(driverExcelPath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

    if (!worksheet) {
      console.warn('No worksheet found in driver Excel file');
      return drivers;
    }

    const rows = XLSX.utils.sheet_to_json(worksheet);

    for (const row of rows) {
      // The columns are: "Abel Door & Trim Driver Information" (Name), "__EMPTY" (DOB), "__EMPTY_1" (DL#)
      const rowData = row as Record<string, any>;
      const nameKey = Object.keys(rowData)[0]; // First column has the names
      const dobKey = Object.keys(rowData)[1]; // Second column has DOB
      const dlKey = Object.keys(rowData)[2]; // Third column has DL#

      const name = rowData[nameKey];

      // Skip header row and empty rows
      if (
        name &&
        typeof name === 'string' &&
        !name.includes('Driver Information') &&
        name.toLowerCase() !== 'name'
      ) {
        drivers.push({
          name: String(name).trim(),
          dob: rowData[dobKey] ? String(rowData[dobKey]).trim() : null,
          dlNumber: rowData[dlKey] ? String(rowData[dlKey]).trim() : null,
        });
      }
    }
  } catch (error) {
    console.error(`Error reading driver Excel file: ${error}`);
  }

  return drivers.sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET(request: NextRequest): Promise<NextResponse<FleetResponse>> {
  // R7 — Fleet response includes driver DOB + DL number (PII).
  // canAccessAPI() gates this on the existing /api/ops/fleet API_ACCESS entry
  // (ADMIN, MANAGER, PROJECT_MANAGER, DRIVER, WAREHOUSE_LEAD).
  const authError = checkStaffAuth(request);
  if (authError) return authError as NextResponse<FleetResponse>;

  try {
    const vehicles = getVehicles();
    const drivers = getDrivers();

    return NextResponse.json(
      {
        vehicles,
        drivers,
        summary: {
          totalVehicles: vehicles.length,
          totalDrivers: drivers.length,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('GET /api/ops/fleet error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fleet data' } as any,
      { status: 500 }
    );
  }
}
