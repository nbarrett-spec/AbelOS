export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;

    // Look up HomeownerAccess by token
    const accessRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT ha."id", ha."name", ha."email", ha."phone", ha."active", ha."expiresAt",
              ha."builderId", ha."projectId",
              b."id" AS "builder_id", b."companyName" AS "builder_companyName",
              b."phone" AS "builder_phone", b."email" AS "builder_email",
              p."id" AS "project_id", p."name" AS "project_name",
              p."jobAddress" AS "project_jobAddress", p."city" AS "project_city", p."state" AS "project_state"
       FROM "HomeownerAccess" ha
       LEFT JOIN "Builder" b ON b."id" = ha."builderId"
       LEFT JOIN "Project" p ON p."id" = ha."projectId"
       WHERE ha."accessToken" = $1
       LIMIT 1`,
      token
    );

    const row = accessRows[0];

    // Validate token is active
    if (!row) {
      return NextResponse.json(
        { error: "Invalid or expired access token" },
        { status: 404 }
      );
    }

    if (!row.active) {
      return NextResponse.json(
        { error: "Access token is no longer active" },
        { status: 403 }
      );
    }

    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "Access token has expired" },
        { status: 403 }
      );
    }

    // Update lastVisitAt timestamp
    await prisma.$executeRawUnsafe(
      `UPDATE "HomeownerAccess" SET "lastVisitAt" = NOW() WHERE "id" = $1`,
      row.id
    );

    // Get selections with product details
    const selections: any[] = await prisma.$queryRawUnsafe(
      `SELECT hs."id", hs."location", hs."baseProductId", hs."selectedProductId",
              hs."adderCost", hs."status", hs."confirmedAt", hs."createdAt", hs."updatedAt",
              hs."homeownerAccessId",
              bp."id" AS "base_id", bp."sku" AS "base_sku", bp."name" AS "base_name",
              bp."description" AS "base_description", bp."basePrice" AS "base_basePrice",
              bp."imageUrl" AS "base_imageUrl", bp."thumbnailUrl" AS "base_thumbnailUrl",
              sp."id" AS "sel_id", sp."sku" AS "sel_sku", sp."name" AS "sel_name",
              sp."description" AS "sel_description", sp."basePrice" AS "sel_basePrice",
              sp."imageUrl" AS "sel_imageUrl", sp."thumbnailUrl" AS "sel_thumbnailUrl"
       FROM "HomeownerSelection" hs
       LEFT JOIN "Product" bp ON bp."id" = hs."baseProductId"
       LEFT JOIN "Product" sp ON sp."id" = hs."selectedProductId"
       WHERE hs."homeownerAccessId" = $1`,
      row.id
    );

    const selectionsWithDetails = selections.map((s) => ({
      id: s.id,
      location: s.location,
      baseProductId: s.baseProductId,
      selectedProductId: s.selectedProductId,
      adderCost: s.adderCost,
      status: s.status,
      confirmedAt: s.confirmedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      homeownerAccessId: s.homeownerAccessId,
      baseProduct: s.base_id ? {
        id: s.base_id, sku: s.base_sku, name: s.base_name,
        description: s.base_description, basePrice: s.base_basePrice,
        imageUrl: s.base_imageUrl, thumbnailUrl: s.base_thumbnailUrl,
      } : null,
      selectedProduct: s.sel_id ? {
        id: s.sel_id, sku: s.sel_sku, name: s.sel_name,
        description: s.sel_description, basePrice: s.sel_basePrice,
        imageUrl: s.sel_imageUrl, thumbnailUrl: s.sel_thumbnailUrl,
      } : null,
    }));

    const totalCost = selectionsWithDetails.reduce(
      (sum, sel) => sum + Number(sel.adderCost || 0),
      0
    );
    const totalSelections = selectionsWithDetails.length;
    const completedSelections = selectionsWithDetails.filter(
      (s) => s.status !== "PENDING"
    ).length;

    return NextResponse.json({
      homeownerAccess: {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
      },
      builder: {
        id: row.builder_id,
        companyName: row.builder_companyName,
        phone: row.builder_phone,
        email: row.builder_email,
      },
      project: {
        id: row.project_id,
        name: row.project_name,
        jobAddress: row.project_jobAddress,
        city: row.project_city,
        state: row.project_state,
      },
      selections: selectionsWithDetails,
      progress: {
        totalSelections,
        completedSelections,
        totalUpgradeCost: totalCost,
        status: completedSelections === totalSelections ? "READY_TO_CONFIRM" : "IN_PROGRESS",
      },
    });
  } catch (error) {
    console.error("Error in homeowner access route:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
