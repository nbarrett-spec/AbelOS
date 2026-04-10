export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(request: NextRequest) {
  try {
    // Get builder session
    const session = await getSession();
    if (!session || !session.builderId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const {
      companyName,
      contactName,
      contactEmail,
      contactPhone,
      address,
      city,
      state,
      zip,
    } = body;

    // Build dynamic UPDATE query with only provided fields
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (companyName !== undefined) {
      updates.push(`"companyName" = $${paramIndex}`);
      values.push(companyName);
      paramIndex++;
    }

    if (contactName !== undefined) {
      updates.push(`"contactName" = $${paramIndex}`);
      values.push(contactName);
      paramIndex++;
    }

    if (contactEmail !== undefined) {
      updates.push(`"contactEmail" = $${paramIndex}`);
      values.push(contactEmail);
      paramIndex++;
    }

    if (contactPhone !== undefined) {
      updates.push(`"contactPhone" = $${paramIndex}`);
      values.push(contactPhone);
      paramIndex++;
    }

    if (address !== undefined) {
      updates.push(`"address" = $${paramIndex}`);
      values.push(address);
      paramIndex++;
    }

    if (city !== undefined) {
      updates.push(`"city" = $${paramIndex}`);
      values.push(city);
      paramIndex++;
    }

    if (state !== undefined) {
      updates.push(`"state" = $${paramIndex}`);
      values.push(state);
      paramIndex++;
    }

    if (zip !== undefined) {
      updates.push(`"zip" = $${paramIndex}`);
      values.push(zip);
      paramIndex++;
    }

    // If no fields to update, return early
    if (updates.length === 0) {
      return NextResponse.json({ success: true });
    }

    // Add builder ID as final parameter
    values.push(session.builderId);

    // Execute UPDATE query
    const query = `
      UPDATE "Builder"
      SET ${updates.join(', ')}
      WHERE "id" = $${paramIndex}
    `;

    await prisma.$executeRawUnsafe(query, ...values);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Profile update error:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
