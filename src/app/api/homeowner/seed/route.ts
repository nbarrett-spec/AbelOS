export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDevAdmin } from "@/lib/api-auth";

/**
 * POST /api/homeowner/seed
 * Create sample homeowner data for testing the portal.
 * DEV ONLY — requires ADMIN auth.
 */
export async function POST(request: NextRequest) {
  const guard = requireDevAdmin(request)
  if (guard) return guard

  try {
    // Get or create demo builder
    const builders: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "companyName" FROM "Builder" WHERE "companyName" ILIKE '%Demo%' LIMIT 1`
    );
    const demoBuilder = builders[0];

    if (!demoBuilder) {
      return NextResponse.json(
        { error: "No demo builder found. Please create a builder first." },
        { status: 400 }
      );
    }

    // Get or create demo project
    const projects: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "name", "jobAddress" FROM "Project" WHERE "builderId" = $1 LIMIT 1`,
      demoBuilder.id
    );
    const demoProject = projects[0];

    if (!demoProject) {
      return NextResponse.json(
        { error: "No demo project found. Please create a project first." },
        { status: 400 }
      );
    }

    // Upsert base products via raw SQL
    const productDefs = [
      { sku: 'DOOR-2068-HC-2P', name: '2068 2-Panel Hollow Core', desc: 'Standard 2-panel hollow core interior door', cat: 'Interior Doors', sub: 'Slab', cost: 45, price: 89, doorSize: '2068', panel: '2-Panel', core: 'Hollow', mat: 'Pine' },
      { sku: 'DOOR-2068-SC-2P', name: '2068 2-Panel Solid Core', desc: 'Solid core 2-panel interior door with better sound dampening', cat: 'Interior Doors', sub: 'Slab', cost: 75, price: 134, doorSize: '2068', panel: '2-Panel', core: 'Solid', mat: 'Pine' },
      { sku: 'DOOR-2068-HC-SHAKER', name: '2068 Shaker Style Hollow Core', desc: 'Shaker style hollow core door', cat: 'Interior Doors', sub: 'Slab', cost: 65, price: 119, doorSize: '2068', panel: 'Shaker', core: 'Hollow', mat: 'Pine' },
      { sku: 'DOOR-EXT-FIBERGLASS', name: 'Fiberglass Entry Door 36in', desc: 'Pre-hung fiberglass exterior entry door', cat: 'Exterior Doors', sub: 'Pre-Hung', cost: 180, price: 349, doorSize: '36in', panel: null, core: null, mat: 'Fiberglass' },
      { sku: 'DOOR-BIFOLD-3P', name: 'Bifold Door 3-Panel', desc: '3-panel bypass bifold door', cat: 'Interior Doors', sub: 'Bifold', cost: 95, price: 179, doorSize: null, panel: 'Bifold', core: 'Hollow', mat: null },
      { sku: 'HARDWARE-SN-INTERIOR', name: 'Interior Hardware Set (Satin Nickel)', desc: 'Satin nickel lever sets for interior doors', cat: 'Hardware', sub: 'Lever Sets', cost: 25, price: 49, doorSize: null, panel: null, core: null, mat: null },
      { sku: 'HARDWARE-BLK-INTERIOR', name: 'Interior Hardware Set (Matte Black)', desc: 'Matte black lever sets for interior doors', cat: 'Hardware', sub: 'Lever Sets', cost: 30, price: 64, doorSize: null, panel: null, core: null, mat: null },
      { sku: 'HARDWARE-ENTRY-STANDARD', name: 'Standard Entry Handleset', desc: 'Entry door handleset with deadbolt', cat: 'Hardware', sub: 'Entry Sets', cost: 45, price: 99, doorSize: null, panel: null, core: null, mat: null },
    ];

    const productIds: Record<string, string> = {};

    for (const p of productDefs) {
      // Check if product exists
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Product" WHERE "sku" = $1 LIMIT 1`, p.sku
      );

      if (existing.length > 0) {
        productIds[p.sku] = existing[0].id;
      } else {
        const id = `prod_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Product" ("id", "sku", "name", "description", "category", "subcategory",
           "cost", "basePrice", "doorSize", "panelStyle", "coreType", "material",
           "active", "inStock", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, true, NOW(), NOW())`,
          id, p.sku, p.name, p.desc, p.cat, p.sub,
          p.cost, p.price, p.doorSize, p.panel, p.core, p.mat
        );
        productIds[p.sku] = id;
      }
    }

    // Create upgrade paths
    const upgradeDefs = [
      { from: 'DOOR-2068-HC-2P', to: 'DOOR-2068-SC-2P', type: 'core', costDelta: 30, priceDelta: 45, desc: 'Upgrade from Hollow Core to Solid Core' },
      { from: 'DOOR-2068-HC-2P', to: 'DOOR-2068-HC-SHAKER', type: 'door_style', costDelta: 20, priceDelta: 30, desc: 'Upgrade to Shaker Style' },
      { from: 'HARDWARE-SN-INTERIOR', to: 'HARDWARE-BLK-INTERIOR', type: 'finish', costDelta: 5, priceDelta: 15, desc: 'Upgrade to Matte Black finish' },
    ];

    for (const u of upgradeDefs) {
      const fromId = productIds[u.from];
      const toId = productIds[u.to];
      if (!fromId || !toId) continue;

      // Check if exists
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "UpgradePath" WHERE "fromProductId" = $1 AND "toProductId" = $2 LIMIT 1`,
        fromId, toId
      );

      if (existing.length === 0) {
        const id = `up_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        await prisma.$executeRawUnsafe(
          `INSERT INTO "UpgradePath" ("id", "fromProductId", "toProductId", "upgradeType",
           "costDelta", "priceDelta", "description", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          id, fromId, toId, u.type, u.costDelta, u.priceDelta, u.desc
        );
      }
    }

    // Create HomeownerAccess record
    const haExisting: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "HomeownerAccess" WHERE "accessToken" = 'demo-homeowner-2026' LIMIT 1`
    );

    let homeownerAccessId: string;
    if (haExisting.length > 0) {
      homeownerAccessId = haExisting[0].id;
    } else {
      homeownerAccessId = `ha_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "HomeownerAccess" ("id", "builderId", "projectId", "name", "email", "phone",
         "accessToken", "active", "expiresAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'Jane Homeowner', 'jane@example.com', '555-0123',
         'demo-homeowner-2026', true, $4, NOW(), NOW())`,
        homeownerAccessId, demoBuilder.id, demoProject.id, expiresAt
      );
    }

    // Create HomeownerSelection records for different rooms
    const selections = [
      { location: 'Master Bedroom Door', baseSku: 'DOOR-2068-HC-2P' },
      { location: 'Front Entry Door', baseSku: 'DOOR-EXT-FIBERGLASS' },
      { location: 'Guest Bath Door', baseSku: 'DOOR-2068-HC-2P' },
      { location: 'Pantry Door', baseSku: 'DOOR-BIFOLD-3P' },
      { location: 'All Interior Hardware', baseSku: 'HARDWARE-SN-INTERIOR' },
      { location: 'Front Door Hardware', baseSku: 'HARDWARE-ENTRY-STANDARD' },
    ];

    for (const sel of selections) {
      const prodId = productIds[sel.baseSku];
      if (!prodId) continue;

      const selId = `${homeownerAccessId}-${sel.location}`.replace(/\s+/g, '-');
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "HomeownerSelection" WHERE "id" = $1 LIMIT 1`,
        selId
      );

      if (existing.length === 0) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "HomeownerSelection" ("id", "homeownerAccessId", "location",
           "baseProductId", "selectedProductId", "adderCost", "status", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $4, 0, 'PENDING', NOW(), NOW())`,
          selId, homeownerAccessId, sel.location, prodId
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: "Demo homeowner portal data created",
      data: {
        accessToken: "demo-homeowner-2026",
        portalUrl: `/homeowner/demo-homeowner-2026`,
        homeowner: { name: "Jane Homeowner", email: "jane@example.com" },
        project: { name: demoProject.name, address: demoProject.jobAddress },
        selectionsCreated: selections.length,
      },
    });
  } catch (error) {
    console.error("Error seeding homeowner data:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}
