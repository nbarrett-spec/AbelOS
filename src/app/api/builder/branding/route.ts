import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const DEFAULT_BRANDING = {
  logoUrl: null,
  primaryColor: '#1B4F72',
  secondaryColor: '#E67E22',
  accentColor: '#2ECC71',
  fontFamily: 'Inter',
  portalTitle: null,
  welcomeMessage: null,
  theme: 'light',
  compactMode: false,
  dashboardLayout: {},
  hiddenWidgets: [],
};

const VALID_THEMES = ['light', 'dark'];
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function isValidHexColor(color: string): boolean {
  return HEX_COLOR_PATTERN.test(color);
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session || !session.builderId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const result = await prisma.$queryRawUnsafe(
      'SELECT * FROM "BuilderBranding" WHERE "builderId" = $1',
      session.builderId
    );

    const branding = Array.isArray(result) && result.length > 0
      ? result[0]
      : DEFAULT_BRANDING;

    return NextResponse.json({ branding });
  } catch (error) {
    console.error('GET /api/builder/branding error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch branding' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session || !session.builderId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate and extract allowed fields
    const updates: Record<string, any> = {};

    if (body.logoUrl !== undefined) {
      updates.logoUrl = body.logoUrl;
    }

    if (body.primaryColor !== undefined) {
      if (!isValidHexColor(body.primaryColor)) {
        return NextResponse.json(
          { error: 'Invalid primary color. Must be a valid hex color.' },
          { status: 400 }
        );
      }
      updates.primaryColor = body.primaryColor;
    }

    if (body.secondaryColor !== undefined) {
      if (!isValidHexColor(body.secondaryColor)) {
        return NextResponse.json(
          { error: 'Invalid secondary color. Must be a valid hex color.' },
          { status: 400 }
        );
      }
      updates.secondaryColor = body.secondaryColor;
    }

    if (body.accentColor !== undefined) {
      if (!isValidHexColor(body.accentColor)) {
        return NextResponse.json(
          { error: 'Invalid accent color. Must be a valid hex color.' },
          { status: 400 }
        );
      }
      updates.accentColor = body.accentColor;
    }

    if (body.fontFamily !== undefined) {
      updates.fontFamily = body.fontFamily;
    }

    if (body.portalTitle !== undefined) {
      updates.portalTitle = body.portalTitle;
    }

    if (body.welcomeMessage !== undefined) {
      updates.welcomeMessage = body.welcomeMessage;
    }

    if (body.theme !== undefined) {
      if (!VALID_THEMES.includes(body.theme)) {
        return NextResponse.json(
          { error: `Invalid theme. Must be one of: ${VALID_THEMES.join(', ')}` },
          { status: 400 }
        );
      }
      updates.theme = body.theme;
    }

    if (body.compactMode !== undefined) {
      updates.compactMode = body.compactMode;
    }

    if (body.dashboardLayout !== undefined) {
      updates.dashboardLayout = body.dashboardLayout;
    }

    if (body.hiddenWidgets !== undefined) {
      updates.hiddenWidgets = body.hiddenWidgets;
    }

    // Build SET clause
    const setClause = Object.keys(updates)
      .map((key, index) => {
        const isJsonb = ['dashboardLayout', 'hiddenWidgets'].includes(key);
        const castSuffix = isJsonb ? '::jsonb' : '';
        return `"${key}" = $${index + 2}${castSuffix}`;
      })
      .join(', ');

    const updateValues = Object.values(updates);

    // Try UPDATE first
    const updateResult = await prisma.$executeRawUnsafe(
      `UPDATE "BuilderBranding" SET ${setClause}, "updatedAt" = NOW() WHERE "builderId" = $1`,
      session.builderId,
      ...updateValues
    );

    if (updateResult === 0) {
      // No rows updated, insert new record
      const id = await prisma.$queryRawUnsafe(
        'SELECT gen_random_uuid()::text as id'
      );
      const newId = Array.isArray(id) && id.length > 0 ? id[0].id : null;

      const insertColumns = ['id', 'builderId', ...Object.keys(updates)];
      const insertPlaceholders = insertColumns
        .map((_, index) => {
          const isJsonb = ['dashboardLayout', 'hiddenWidgets'].includes(insertColumns[index]);
          const castSuffix = isJsonb ? '::jsonb' : '';
          return `$${index + 1}${castSuffix}`;
        })
        .join(', ');

      await prisma.$executeRawUnsafe(
        `INSERT INTO "BuilderBranding" (${insertColumns.join(', ')}) VALUES (${insertPlaceholders})`,
        newId,
        session.builderId,
        ...updateValues
      );
    }

    // Fetch updated branding
    const result = await prisma.$queryRawUnsafe(
      'SELECT * FROM "BuilderBranding" WHERE "builderId" = $1',
      session.builderId
    );

    const branding = Array.isArray(result) && result.length > 0
      ? result[0]
      : DEFAULT_BRANDING;

    return NextResponse.json({ branding });
  } catch (error) {
    console.error('PATCH /api/builder/branding error:', error);
    return NextResponse.json(
      { error: 'Failed to update branding' },
      { status: 500 }
    );
  }
}
