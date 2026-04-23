export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Bearer token auth for cron
function validateCronAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return false;
  }
  return true;
}

// Generate unique ID
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface AlertPayload {
  type: string;
  title: string;
  body: string;
  priority: string;
  entityType: string;
  entityId: string;
  actionData?: Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const alerts: AlertPayload[] = [];
    let duplicatesSkipped = 0;

    // 1. Credit Breach Alert: Builders where AR outstanding > creditLimit
    const creditBreachResults = await prisma.$queryRawUnsafe<
      Array<{ id: string; companyName: string; creditLimit: number; ar: number }>
    >(
      `SELECT b.id, b."companyName", b."creditLimit", COALESCE(SUM(i."total" - COALESCE(i."amountPaid",0)),0)::numeric as ar
       FROM "Builder" b
       LEFT JOIN "Invoice" i ON i."builderId" = b.id AND i.status::text IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE')
       WHERE b.status = 'ACTIVE' AND b."creditLimit" > 0
       GROUP BY b.id, b."companyName", b."creditLimit"
       HAVING COALESCE(SUM(i."total" - COALESCE(i."amountPaid",0)),0) > b."creditLimit"`
    );

    for (const result of creditBreachResults) {
      const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "InboxItem"
         WHERE type = 'NUC_CREDIT_BREACH' AND "entityId" = $1 AND status = 'PENDING'
         LIMIT 1`,
        result.id
      );

      if (existing.length === 0) {
        const id = generateId('nuc_alert');
        alerts.push({
          type: 'NUC_CREDIT_BREACH',
          title: `Credit Limit Breach: ${result.companyName}`,
          body: `Outstanding AR of $${result.ar.toFixed(2)} exceeds credit limit of $${result.creditLimit.toFixed(2)}`,
          priority: 'CRITICAL',
          entityType: 'Builder',
          entityId: result.id,
          actionData: {
            builderId: result.id,
            companyName: result.companyName,
            arOutstanding: result.ar,
            creditLimit: result.creditLimit,
            excessAmount: result.ar - result.creditLimit,
          },
        });
      } else {
        duplicatesSkipped++;
      }
    }

    // 2. Stale Quote Alert: Quotes in SENT status for 7+ days
    const staleQuoteResults = await prisma.$queryRawUnsafe<
      Array<{ id: string; quoteNumber: string; total: number; createdAt: Date }>
    >(
      `SELECT q.id, q."quoteNumber", q.total, q."createdAt"
       FROM "Quote" q
       WHERE q.status = 'SENT' AND q."createdAt" < NOW() - INTERVAL '7 days'`
    );

    for (const result of staleQuoteResults) {
      const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "InboxItem"
         WHERE type = 'NUC_STALE_QUOTE' AND "entityId" = $1 AND status = 'PENDING'
         LIMIT 1`,
        result.id
      );

      if (existing.length === 0) {
        const daysOld = Math.floor(
          (Date.now() - result.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        );
        alerts.push({
          type: 'NUC_STALE_QUOTE',
          title: `Stale Quote: ${result.quoteNumber}`,
          body: `Quote has been pending for ${daysOld} days with no activity. Total: $${result.total.toFixed(2)}`,
          priority: 'MEDIUM',
          entityType: 'Quote',
          entityId: result.id,
          actionData: {
            quoteId: result.id,
            quoteNumber: result.quoteNumber,
            total: result.total,
            daysOld,
          },
        });
      } else {
        duplicatesSkipped++;
      }
    }

    // 3. Inventory Stockout Alert: Products with onHand = 0 that have pending orders
    const stockoutResults = await prisma.$queryRawUnsafe<
      Array<{ id: string; productName: string; onHand: number }>
    >(
      `SELECT ii.id, ii."productName", ii."onHand"
       FROM "InventoryItem" ii
       WHERE ii."onHand" <= 0 AND ii.status = 'IN_STOCK'`
    );

    for (const result of stockoutResults) {
      const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "InboxItem"
         WHERE type = 'NUC_STOCKOUT' AND "entityId" = $1 AND status = 'PENDING'
         LIMIT 1`,
        result.id
      );

      if (existing.length === 0) {
        const id = generateId('nuc_alert');
        alerts.push({
          type: 'NUC_STOCKOUT',
          title: `Inventory Stockout: ${result.productName}`,
          body: `Product is out of stock (onHand: ${result.onHand})`,
          priority: 'HIGH',
          entityType: 'InventoryItem',
          entityId: result.id,
          actionData: {
            inventoryItemId: result.id,
            productName: result.productName,
            onHand: result.onHand,
          },
        });
      } else {
        duplicatesSkipped++;
      }
    }

    // 4. Overdue Invoice Escalation: Invoices 45+ days past due
    const overdueResults = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        invoiceNumber: string;
        balanceDue: number;
        companyName: string;
        dueDate: Date;
      }>
    >(
      `SELECT i.id, i."invoiceNumber", (i."total" - COALESCE(i."amountPaid",0))::float as "balanceDue", b."companyName", i."dueDate"
       FROM "Invoice" i
       JOIN "Builder" b ON b.id = i."builderId"
       WHERE i."dueDate" < NOW() - INTERVAL '45 days'
         AND i.status::text IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE')
         AND (i."total" - COALESCE(i."amountPaid",0)) > 0`
    );

    for (const result of overdueResults) {
      const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "InboxItem"
         WHERE type = 'NUC_OVERDUE_ESCALATION' AND "entityId" = $1 AND status = 'PENDING'
         LIMIT 1`,
        result.id
      );

      if (existing.length === 0) {
        const daysOverdue = Math.floor(
          (Date.now() - result.dueDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        alerts.push({
          type: 'NUC_OVERDUE_ESCALATION',
          title: `Overdue Invoice: ${result.invoiceNumber} (${result.companyName})`,
          body: `Invoice is ${daysOverdue} days overdue. Balance due: $${result.balanceDue.toFixed(2)}`,
          priority: 'CRITICAL',
          entityType: 'Invoice',
          entityId: result.id,
          actionData: {
            invoiceId: result.id,
            invoiceNumber: result.invoiceNumber,
            companyName: result.companyName,
            balanceDue: result.balanceDue,
            daysOverdue,
          },
        });
      } else {
        duplicatesSkipped++;
      }
    }

    // 5. Margin Erosion Alert: Products where basePrice - cost < basePrice * 0.05 (under 5% margin)
    const marginResults = await prisma.$queryRawUnsafe<
      Array<{ id: string; name: string; basePrice: number; cost: number | null }>
    >(
      `SELECT p.id, p.name, p."basePrice", p.cost
       FROM "Product" p
       WHERE p.status = 'ACTIVE'
         AND p."basePrice" > 0
         AND (p."basePrice" - COALESCE(p.cost,0)) / p."basePrice" < 0.05`
    );

    for (const result of marginResults) {
      const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "InboxItem"
         WHERE type = 'NUC_MARGIN_EROSION' AND "entityId" = $1 AND status = 'PENDING'
         LIMIT 1`,
        result.id
      );

      if (existing.length === 0) {
        const cost = result.cost || 0;
        const margin = ((result.basePrice - cost) / result.basePrice) * 100;
        alerts.push({
          type: 'NUC_MARGIN_EROSION',
          title: `Low Margin Product: ${result.name}`,
          body: `Product margin is ${margin.toFixed(2)}% (under 5% threshold). Base price: $${result.basePrice.toFixed(2)}, Cost: $${cost.toFixed(2)}`,
          priority: 'MEDIUM',
          entityType: 'Product',
          entityId: result.id,
          actionData: {
            productId: result.id,
            productName: result.name,
            basePrice: result.basePrice,
            cost,
            marginPercent: margin,
          },
        });
      } else {
        duplicatesSkipped++;
      }
    }

    // Bulk insert all new alerts into InboxItem
    for (const alert of alerts) {
      const id = generateId('nuc_alert');
      const actionDataJson = JSON.stringify(alert.actionData || {});

      await prisma.$executeRawUnsafe(
        `INSERT INTO "InboxItem"
         (id, type, title, body, priority, status, "entityType", "entityId", "actionData", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8, NOW(), NOW())`,
        id,
        alert.type,
        alert.title,
        alert.body,
        alert.priority,
        alert.entityType,
        alert.entityId,
        actionDataJson
      );
    }

    return NextResponse.json(
      {
        generated: alerts.length,
        skippedDuplicates: duplicatesSkipped,
        alerts: alerts.map((a) => ({
          type: a.type,
          title: a.title,
          priority: a.priority,
        })),
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[nuc-alerts cron] error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
