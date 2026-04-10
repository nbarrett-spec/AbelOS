export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;

    // Validate token
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT ha."id", ha."active", ha."expiresAt"
       FROM "HomeownerAccess" ha
       WHERE ha."accessToken" = $1
       LIMIT 1`,
      token
    );

    const homeownerAccess = rows[0];
    if (!homeownerAccess || !homeownerAccess.active) {
      return NextResponse.json(
        { error: "Invalid or inactive token" },
        { status: 403 }
      );
    }

    if (
      homeownerAccess.expiresAt &&
      new Date(homeownerAccess.expiresAt) < new Date()
    ) {
      return NextResponse.json(
        { error: "Token expired" },
        { status: 403 }
      );
    }

    // Check for pending selections
    const pendingResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS "count"
       FROM "HomeownerSelection"
       WHERE "homeownerAccessId" = $1 AND "status" = 'PENDING'`,
      homeownerAccess.id
    );
    const pendingCount = pendingResult[0]?.count || 0;

    if (pendingCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot confirm: ${pendingCount} selection(s) still pending`,
          pendingCount,
        },
        { status: 400 }
      );
    }

    // Lock all selections to CONFIRMED
    const updateResult: any[] = await prisma.$queryRawUnsafe(
      `UPDATE "HomeownerSelection"
       SET "status" = 'CONFIRMED', "confirmedAt" = NOW()
       WHERE "homeownerAccessId" = $1
       RETURNING "id"`,
      homeownerAccess.id
    );

    return NextResponse.json({
      success: true,
      message: `Confirmed ${updateResult.length} selection(s)`,
      count: updateResult.length,
    });
  } catch (error) {
    console.error("Error confirming selections:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
