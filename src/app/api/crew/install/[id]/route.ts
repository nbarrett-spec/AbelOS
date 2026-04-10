export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const id = params.id;

    // Get installation with related job
    const installationResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      jobId: string;
      installNumber: string;
      status: string;
      scopeNotes: string | null;
      startedAt: Date | null;
      completedAt: Date | null;
      passedQC: boolean | null;
      punchItems: string | null;
      notes: string | null;
      beforePhotos: string | null;
      afterPhotos: string | null;
      job_id: string;
      jobNumber: string;
      builderName: string;
      builderContact: string;
      community: string | null;
      lotBlock: string | null;
      jobAddress: string | null;
    }>>(
      `SELECT i.*, j.id as job_id, j."jobNumber", j."builderName", j."builderContact", j.community, j."lotBlock", j."jobAddress"
       FROM "Installation" i
       JOIN "Job" j ON i."jobId" = j.id
       WHERE i.id = $1`,
      id
    );

    if (!installationResult || installationResult.length === 0) {
      return NextResponse.json(
        { error: 'Installation not found' },
        { status: 404 }
      );
    }

    const installation = installationResult[0];

    return NextResponse.json({
      id: installation.id,
      jobId: installation.jobId,
      installNumber: installation.installNumber,
      status: installation.status,
      scopeNotes: installation.scopeNotes,
      job: {
        id: installation.job_id,
        jobNumber: installation.jobNumber,
        builderName: installation.builderName,
        builderContact: installation.builderContact,
        community: installation.community,
        lotBlock: installation.lotBlock,
        jobAddress: installation.jobAddress,
      },
      startedAt: installation.startedAt,
      completedAt: installation.completedAt,
      passedQC: installation.passedQC,
      punchItems: installation.punchItems,
      notes: installation.notes,
      beforePhotos: installation.beforePhotos,
      afterPhotos: installation.afterPhotos,
    });
  } catch (error) {
    console.error('Failed to get installation:', error);
    return NextResponse.json(
      { error: 'Failed to get installation' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError2 = checkStaffAuth(request);
  if (authError2) return authError2;
  try {
    const id = params.id;
    const body = await request.json();

    const {
      status,
      notes,
      punchItems,
      passedQC,
      startedAt,
      completedAt,
    } = body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [id];
    let paramIndex = 2;

    if (status) {
      updates.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex}`);
      values.push(notes);
      paramIndex++;
    }
    if (punchItems !== undefined) {
      updates.push(`"punchItems" = $${paramIndex}`);
      values.push(punchItems);
      paramIndex++;
    }
    if (passedQC !== undefined) {
      updates.push(`"passedQC" = $${paramIndex}`);
      values.push(passedQC);
      paramIndex++;
    }
    if (startedAt) {
      updates.push(`"startedAt" = $${paramIndex}`);
      values.push(new Date(startedAt));
      paramIndex++;
    }
    if (completedAt) {
      updates.push(`"completedAt" = $${paramIndex}`);
      values.push(new Date(completedAt));
      paramIndex++;
    }

    // Only execute update if there are changes
    if (updates.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Installation" SET ${updates.join(', ')} WHERE id = $1`,
        ...values
      );
    }

    // Get updated installation with related job
    const installationResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      jobId: string;
      installNumber: string;
      status: string;
      scopeNotes: string | null;
      startedAt: Date | null;
      completedAt: Date | null;
      passedQC: boolean | null;
      punchItems: string | null;
      notes: string | null;
      jobNumber: string;
      builderName: string;
      builderContact: string;
      community: string | null;
      lotBlock: string | null;
      jobAddress: string | null;
    }>>(
      `SELECT i.*, j."jobNumber", j."builderName", j."builderContact", j.community, j."lotBlock", j."jobAddress"
       FROM "Installation" i
       JOIN "Job" j ON i."jobId" = j.id
       WHERE i.id = $1`,
      id
    );

    const installation = installationResult?.[0];

    if (!installation) {
      return NextResponse.json(
        { error: 'Installation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: installation.id,
      jobId: installation.jobId,
      installNumber: installation.installNumber,
      status: installation.status,
      scopeNotes: installation.scopeNotes,
      job: {
        jobNumber: installation.jobNumber,
        builderName: installation.builderName,
        builderContact: installation.builderContact,
        community: installation.community,
        lotBlock: installation.lotBlock,
        jobAddress: installation.jobAddress,
      },
      startedAt: installation.startedAt,
      completedAt: installation.completedAt,
      passedQC: installation.passedQC,
      punchItems: installation.punchItems,
      notes: installation.notes,
    });
  } catch (error) {
    console.error('Failed to update installation:', error);
    return NextResponse.json(
      { error: 'Failed to update installation' },
      { status: 500 }
    );
  }
}
