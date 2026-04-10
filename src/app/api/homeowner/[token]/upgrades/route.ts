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

    const { searchParams } = new URL(request.url);
    const baseProductId = searchParams.get("baseProductId");

    if (!baseProductId) {
      return NextResponse.json(
        { error: "baseProductId parameter required" },
        { status: 400 }
      );
    }

    // Get upgrade paths with product details
    const upgradePaths: any[] = await prisma.$queryRawUnsafe(
      `SELECT up."id", up."fromProductId", up."toProductId", up."upgradeType",
              up."description", up."priceDelta", up."builderId",
              p."id" AS "productId", p."sku", p."name", p."description" AS "productDescription",
              p."category", p."subcategory", p."basePrice", p."imageUrl", p."thumbnailUrl"
       FROM "UpgradePath" up
       JOIN "Product" p ON p."id" = up."toProductId"
       WHERE up."fromProductId" = $1
       ORDER BY up."priceDelta" ASC`,
      baseProductId
    );

    // Separate builder-specific and Abel premium upgrades
    const builderUpgrades: any[] = [];
    const abelUpgrades: any[] = [];

    upgradePaths.forEach((path) => {
      const upgrade = {
        id: path.id,
        fromProductId: path.fromProductId,
        toProductId: path.toProductId,
        upgradeType: path.upgradeType || 'STANDARD',
        category: path.builderId ? 'BUILDER_OPTION' : 'ABEL_PREMIUM',
        description: path.description || `Upgrade to ${path.name}`,
        priceDelta: path.priceDelta,
        product: {
          id: path.productId,
          sku: path.sku,
          name: path.name,
          description: path.productDescription,
          category: path.category,
          subcategory: path.subcategory,
          basePrice: path.basePrice,
          imageUrl: path.imageUrl,
          thumbnailUrl: path.thumbnailUrl,
        },
      };

      if (path.builderId) {
        builderUpgrades.push(upgrade);
      } else {
        abelUpgrades.push(upgrade);
      }
    });

    // If no explicit paths, try category-based discovery
    let upgrades = [...abelUpgrades, ...builderUpgrades];

    if (upgrades.length === 0) {
      // Get base product category and price
      const baseProduct: any[] = await prisma.$queryRawUnsafe(
        `SELECT "category", "basePrice" FROM "Product" WHERE "id" = $1`,
        baseProductId
      );

      if (baseProduct[0]) {
        const categoryProducts: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id", "sku", "name", "description", "basePrice", "imageUrl", "thumbnailUrl", "category"
           FROM "Product"
           WHERE "category" = $1 AND "basePrice" > $2 AND "active" = true
           ORDER BY "basePrice" ASC
           LIMIT 5`,
          baseProduct[0].category,
          baseProduct[0].basePrice
        );

        upgrades = categoryProducts.map((p) => ({
          id: `auto_${p.id}`,
          fromProductId: baseProductId,
          toProductId: p.id,
          upgradeType: 'PREMIUM',
          category: 'ABEL_PREMIUM',
          description: `Upgrade to ${p.name}`,
          priceDelta: Math.round((p.basePrice - baseProduct[0].basePrice) * 100) / 100,
          product: {
            id: p.id,
            sku: p.sku,
            name: p.name,
            description: p.description,
            category: p.category,
            basePrice: p.basePrice,
            imageUrl: p.imageUrl,
            thumbnailUrl: p.thumbnailUrl,
          },
        }));
      }
    }

    return NextResponse.json(upgrades);
  } catch (error) {
    console.error("Error fetching upgrades:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

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
    const { selectionId, newProductId, priceDifference } = body;

    if (!selectionId || !newProductId) {
      return NextResponse.json(
        { error: "selectionId and newProductId are required" },
        { status: 400 }
      );
    }

    // Verify selection belongs to this homeowner
    const selection: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "HomeownerSelection"
       WHERE "id" = $1 AND "homeownerAccessId" = $2`,
      selectionId,
      homeownerAccess.id
    );

    if (!selection[0]) {
      return NextResponse.json(
        { error: "Selection not found or unauthorized" },
        { status: 404 }
      );
    }

    // Update the selection with the upgrade
    await prisma.$executeRawUnsafe(
      `UPDATE "HomeownerSelection"
       SET "selectedProductId" = $1, "adderCost" = $2, "updatedAt" = NOW()
       WHERE "id" = $3`,
      newProductId,
      priceDifference || 0,
      selectionId
    );

    // Fetch updated selection with product details
    const updated: any[] = await prisma.$queryRawUnsafe(
      `SELECT hs.*,
              bp."id" AS "base_id", bp."sku" AS "base_sku", bp."name" AS "base_name",
              bp."description" AS "base_description", bp."basePrice" AS "base_basePrice",
              bp."imageUrl" AS "base_imageUrl", bp."thumbnailUrl" AS "base_thumbnailUrl",
              sp."id" AS "sel_id", sp."sku" AS "sel_sku", sp."name" AS "sel_name",
              sp."description" AS "sel_description", sp."basePrice" AS "sel_basePrice",
              sp."imageUrl" AS "sel_imageUrl", sp."thumbnailUrl" AS "sel_thumbnailUrl"
       FROM "HomeownerSelection" hs
       LEFT JOIN "Product" bp ON bp."id" = hs."baseProductId"
       LEFT JOIN "Product" sp ON sp."id" = hs."selectedProductId"
       WHERE hs."id" = $1`,
      selectionId
    );

    const u = updated[0];
    return NextResponse.json({
      id: u.id,
      location: u.location,
      baseProductId: u.baseProductId,
      selectedProductId: u.selectedProductId,
      adderCost: u.adderCost,
      status: u.status,
      baseProduct: u.base_id ? {
        id: u.base_id,
        sku: u.base_sku,
        name: u.base_name,
        description: u.base_description,
        basePrice: u.base_basePrice,
        imageUrl: u.base_imageUrl,
        thumbnailUrl: u.base_thumbnailUrl,
      } : null,
      selectedProduct: u.sel_id ? {
        id: u.sel_id,
        sku: u.sel_sku,
        name: u.sel_name,
        description: u.sel_description,
        basePrice: u.sel_basePrice,
        imageUrl: u.sel_imageUrl,
        thumbnailUrl: u.sel_thumbnailUrl,
      } : null,
    });
  } catch (error) {
    console.error("Error applying upgrade:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
