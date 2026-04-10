export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Helper to validate token
async function validateToken(token: string): Promise<{ id: string } | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "active", "expiresAt"
     FROM "HomeownerAccess"
     WHERE "accessToken" = $1
     LIMIT 1`,
    token
  );
  const ha = rows[0];
  if (!ha || !ha.active) return null;
  if (ha.expiresAt && new Date(ha.expiresAt) < new Date()) return null;
  return ha;
}

// GET: Return all selections for this homeowner with full product details
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const homeownerAccess = await validateToken(params.token);
    if (!homeownerAccess) {
      return NextResponse.json(
        { error: "Invalid or inactive token" },
        { status: 403 }
      );
    }

    // Get all selections with product details in a single query
    const selections: any[] = await prisma.$queryRawUnsafe(
      `SELECT hs."id", hs."location", hs."baseProductId", hs."selectedProductId",
              hs."adderCost", hs."status", hs."confirmedAt", hs."createdAt", hs."updatedAt",
              hs."homeownerAccessId",
              bp."id" AS "base_id", bp."sku" AS "base_sku", bp."name" AS "base_name",
              bp."description" AS "base_description", bp."basePrice" AS "base_basePrice",
              bp."imageUrl" AS "base_imageUrl",
              sp."id" AS "sel_id", sp."sku" AS "sel_sku", sp."name" AS "sel_name",
              sp."description" AS "sel_description", sp."basePrice" AS "sel_basePrice",
              sp."imageUrl" AS "sel_imageUrl"
       FROM "HomeownerSelection" hs
       LEFT JOIN "Product" bp ON bp."id" = hs."baseProductId"
       LEFT JOIN "Product" sp ON sp."id" = hs."selectedProductId"
       WHERE hs."homeownerAccessId" = $1`,
      homeownerAccess.id
    );

    const selectionsWithProducts = selections.map((s) => ({
      id: s.id, location: s.location, baseProductId: s.baseProductId,
      selectedProductId: s.selectedProductId, adderCost: s.adderCost,
      status: s.status, confirmedAt: s.confirmedAt,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
      homeownerAccessId: s.homeownerAccessId,
      baseProduct: s.base_id ? {
        id: s.base_id, sku: s.base_sku, name: s.base_name,
        description: s.base_description, basePrice: s.base_basePrice, imageUrl: s.base_imageUrl,
      } : null,
      selectedProduct: s.sel_id ? {
        id: s.sel_id, sku: s.sel_sku, name: s.sel_name,
        description: s.sel_description, basePrice: s.sel_basePrice, imageUrl: s.sel_imageUrl,
      } : null,
    }));

    return NextResponse.json(selectionsWithProducts);
  } catch (error) {
    console.error("Error fetching selections:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST: Create/update a selection
export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const homeownerAccess = await validateToken(params.token);
    if (!homeownerAccess) {
      return NextResponse.json(
        { error: "Invalid or inactive token" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { location, selectedProductId, adderCost, selectionId } = body;

    if (selectionId) {
      // Update existing selection
      await prisma.$executeRawUnsafe(
        `UPDATE "HomeownerSelection"
         SET "selectedProductId" = $1, "adderCost" = $2, "status" = 'PENDING', "updatedAt" = NOW()
         WHERE "id" = $3`,
        selectedProductId,
        adderCost || 0,
        selectionId
      );

      // Fetch updated selection with products
      const updated: any[] = await prisma.$queryRawUnsafe(
        `SELECT hs.*,
                bp."id" AS "base_id", bp."sku" AS "base_sku", bp."name" AS "base_name",
                bp."description" AS "base_description", bp."basePrice" AS "base_basePrice",
                sp."id" AS "sel_id", sp."sku" AS "sel_sku", sp."name" AS "sel_name",
                sp."description" AS "sel_description", sp."basePrice" AS "sel_basePrice"
         FROM "HomeownerSelection" hs
         LEFT JOIN "Product" bp ON bp."id" = hs."baseProductId"
         LEFT JOIN "Product" sp ON sp."id" = hs."selectedProductId"
         WHERE hs."id" = $1`,
        selectionId
      );

      const u = updated[0];
      return NextResponse.json({
        ...u,
        baseProduct: u?.base_id ? { id: u.base_id, sku: u.base_sku, name: u.base_name, description: u.base_description, basePrice: u.base_basePrice } : null,
        selectedProduct: u?.sel_id ? { id: u.sel_id, sku: u.sel_sku, name: u.sel_name, description: u.sel_description, basePrice: u.sel_basePrice } : null,
      });
    }

    // Create new selection
    const newId = `hs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "HomeownerSelection" ("id", "homeownerAccessId", "location", "baseProductId", "selectedProductId", "adderCost", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $4, $5, 'PENDING', NOW(), NOW())`,
      newId,
      homeownerAccess.id,
      location,
      selectedProductId,
      adderCost || 0
    );

    // Fetch created selection with products
    const created: any[] = await prisma.$queryRawUnsafe(
      `SELECT hs.*,
              bp."id" AS "base_id", bp."sku" AS "base_sku", bp."name" AS "base_name",
              sp."id" AS "sel_id", sp."sku" AS "sel_sku", sp."name" AS "sel_name"
       FROM "HomeownerSelection" hs
       LEFT JOIN "Product" bp ON bp."id" = hs."baseProductId"
       LEFT JOIN "Product" sp ON sp."id" = hs."selectedProductId"
       WHERE hs."id" = $1`,
      newId
    );

    const c = created[0];
    return NextResponse.json(
      {
        ...c,
        baseProduct: c?.base_id ? { id: c.base_id, sku: c.base_sku, name: c.base_name } : null,
        selectedProduct: c?.sel_id ? { id: c.sel_id, sku: c.sel_sku, name: c.sel_name } : null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating/updating selection:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
