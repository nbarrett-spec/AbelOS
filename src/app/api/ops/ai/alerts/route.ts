import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuthWithFallback } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';

interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: string;
  status: string;
  entityType: string;
  entityId: string;
  actionData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function GET(request: NextRequest) {
  const auth = checkStaffAuthWithFallback(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch active NUC alerts ordered by priority and creation date
    const alerts = await prisma.$queryRawUnsafe<InboxItem[]>(
      `SELECT *
       FROM "InboxItem"
       WHERE type IN ('NUC_CREDIT_BREACH', 'NUC_STALE_QUOTE', 'NUC_STOCKOUT', 'NUC_OVERDUE_ESCALATION', 'NUC_MARGIN_EROSION')
         AND status IN ('PENDING', 'IN_PROGRESS')
       ORDER BY
         CASE priority
           WHEN 'CRITICAL' THEN 1
           WHEN 'HIGH' THEN 2
           WHEN 'MEDIUM' THEN 3
           ELSE 4
         END,
         "createdAt" DESC
       LIMIT 50`
    );

    // Parse actionData JSON strings back to objects
    const parsedAlerts = alerts.map((alert) => ({
      ...alert,
      actionData:
        typeof alert.actionData === 'string' ? JSON.parse(alert.actionData) : alert.actionData,
    }));

    // Build summary counts by priority
    const summary = {
      total: parsedAlerts.length,
      critical: parsedAlerts.filter((a) => a.priority === 'CRITICAL').length,
      high: parsedAlerts.filter((a) => a.priority === 'HIGH').length,
      medium: parsedAlerts.filter((a) => a.priority === 'MEDIUM').length,
      low: parsedAlerts.filter((a) => a.priority === 'LOW').length,
    };

    return NextResponse.json(
      {
        alerts: parsedAlerts,
        summary,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[ops/ai/alerts GET] error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Unknown error',
      },
      { status: 500 }
    );
  }
}

interface PatchBody {
  alertId: string;
  status: string;
}

export async function PATCH(request: NextRequest) {
  const auth = checkStaffAuthWithFallback(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body: PatchBody = await request.json();

    // Validate required fields
    if (!body.alertId || !body.status) {
      return NextResponse.json(
        { error: 'Missing required fields: alertId, status' },
        { status: 400 }
      );
    }

    // Validate status value
    const validStatuses = ['PENDING', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        {
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Update alert status
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem"
       SET status = $1, "updatedAt" = NOW()
       WHERE id = $2`,
      body.status,
      body.alertId
    );

    // Check if update affected any rows
    if (result === 0) {
      return NextResponse.json(
        { error: 'Alert not found' },
        { status: 404 }
      );
    }

    audit(request, `UPDATE_STATUS_${body.status}`, 'InboxItem', body.alertId, {
      newStatus: body.status,
    }).catch(() => {});

    // Fetch updated alerts for response
    const updatedAlerts = await prisma.$queryRawUnsafe<InboxItem[]>(
      `SELECT *
       FROM "InboxItem"
       WHERE type IN ('NUC_CREDIT_BREACH', 'NUC_STALE_QUOTE', 'NUC_STOCKOUT', 'NUC_OVERDUE_ESCALATION', 'NUC_MARGIN_EROSION')
         AND status IN ('PENDING', 'IN_PROGRESS')
       ORDER BY
         CASE priority
           WHEN 'CRITICAL' THEN 1
           WHEN 'HIGH' THEN 2
           WHEN 'MEDIUM' THEN 3
           ELSE 4
         END,
         "createdAt" DESC
       LIMIT 50`
    );

    // Parse actionData JSON strings back to objects
    const parsedAlerts = updatedAlerts.map((alert) => ({
      ...alert,
      actionData:
        typeof alert.actionData === 'string' ? JSON.parse(alert.actionData) : alert.actionData,
    }));

    // Build summary counts by priority
    const summary = {
      total: parsedAlerts.length,
      critical: parsedAlerts.filter((a) => a.priority === 'CRITICAL').length,
      high: parsedAlerts.filter((a) => a.priority === 'HIGH').length,
      medium: parsedAlerts.filter((a) => a.priority === 'MEDIUM').length,
      low: parsedAlerts.filter((a) => a.priority === 'LOW').length,
    };

    return NextResponse.json(
      {
        alerts: parsedAlerts,
        summary,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[ops/ai/alerts PATCH] error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Unknown error',
      },
      { status: 500 }
    );
  }
}
