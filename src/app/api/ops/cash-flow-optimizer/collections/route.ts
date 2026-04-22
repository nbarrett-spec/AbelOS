export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';
import { audit } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    // Get all outstanding invoices with builder info.
    // NOTE: dueDate is DateTime? (timestamp). `CURRENT_DATE - timestamp` returns
    // an interval, which marshals into JS as a non-numeric value and downstream
    // arithmetic produces NaN → 500. We cast to date first so the subtraction
    // produces an integer day count, and COALESCE to 0 for null due dates.
    const outstandingInvoices = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        i."id",
        i."invoiceNumber",
        i."builderId",
        i."subtotal",
        i."taxAmount",
        i."total",
        i."amountPaid",
        (i."total" - COALESCE(i."amountPaid",0))::float AS "balanceDue",
        i."status",
        i."paymentTerm",
        i."issuedAt",
        i."dueDate",
        i."paidAt",
        b."companyName",
        b."contactName",
        b."email",
        b."phone",
        b."creditLimit",
        b."accountBalance",
        b."status" as "builderStatus",
        COALESCE((CURRENT_DATE - i."dueDate"::date), 0)::int as "daysOverdue"
      FROM "Invoice" i
      JOIN "Builder" b ON i."builderId" = b."id"
      WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND (i."total" - COALESCE(i."amountPaid",0)) > 0
      ORDER BY i."dueDate" ASC NULLS LAST
    `);

    // Get payment history stats per builder.
    // NOTE: EXTRACT(DAY FROM interval) returns only the day component of an
    // interval, not the total days — so a 63-day interval returns 3. We use
    // direct date subtraction to get the correct total day count.
    const paymentStats = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        b."id" as "builderId",
        COUNT(i."id")::int as "totalInvoices",
        COALESCE(AVG((COALESCE(i."paidAt"::date, CURRENT_DATE) - i."issuedAt"::date))::int, 0) as "avgPaymentDays",
        COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (COALESCE(i."paidAt"::date, CURRENT_DATE) - i."issuedAt"::date))::int, 0) as "medianPaymentDays",
        COALESCE(SUM(CASE WHEN i."paidAt" IS NOT NULL AND i."dueDate" IS NOT NULL AND i."paidAt" <= i."dueDate" THEN 1 ELSE 0 END)::int, 0) as "onTimeCount"
      FROM "Builder" b
      LEFT JOIN "Invoice" i
        ON b."id" = i."builderId"
        AND i."status"::text = 'PAID'
        AND i."issuedAt" IS NOT NULL
      GROUP BY b."id"
    `);

    const statsMap = new Map(paymentStats.map(s => [s.builderId, s]));

    // Calculate priority scores for each invoice
    interface ScoredInvoice {
      id: string;
      invoiceNumber: string;
      builderId: string;
      balanceDue: number;
      status: string;
      paymentTerm: string;
      daysOverdue: number;
      companyName: string;
      contactName: string;
      email: string;
      phone: string;
      dueDate: string;
      urgencyBucket: string;
      priorityScore: number;
      scoreBreakdown: {
        amountFactor: number;
        daysOverdueFactor: number;
        paymentHistoryFactor: number;
        termAdjustment: number;
      };
    }

    const scoredInvoices: ScoredInvoice[] = outstandingInvoices.map((invoice) => {
      const stats = statsMap.get(invoice.builderId) || {
        avgPaymentDays: 0,
        totalInvoices: 0,
        onTimeCount: 0,
      };

      const daysOverdue = Math.max(0, invoice.daysOverdue || 0);
      const onTimeRate =
        stats.totalInvoices > 0 ? stats.onTimeCount / stats.totalInvoices : 0;

      // Normalize scores (0-100 range for each factor)
      const amountFactor = Math.min(100, (invoice.balanceDue / 50000) * 100);
      const daysOverdueFactor = Math.min(100, (daysOverdue / 90) * 100);
      const paymentHistoryFactor = (1 - onTimeRate) * 100;

      // Payment term adjustment: stricter for shorter terms
      let termAdjustment = 0;
      if (invoice.paymentTerm === 'PAY_AT_ORDER') termAdjustment = 15;
      else if (invoice.paymentTerm === 'PAY_ON_DELIVERY') termAdjustment = 10;
      else if (invoice.paymentTerm === 'NET_15') termAdjustment = 5;

      // Weighted priority score
      const priorityScore =
        amountFactor * 0.35 +
        daysOverdueFactor * 0.4 +
        paymentHistoryFactor * 0.15 +
        termAdjustment * 0.1;

      // Determine urgency bucket
      let urgencyBucket = 'NOT_DUE';
      if (daysOverdue > 60) urgencyBucket = 'CRITICAL';
      else if (daysOverdue > 30) urgencyBucket = 'HIGH';
      else if (daysOverdue > 15) urgencyBucket = 'MEDIUM';
      else if (daysOverdue >= 0) urgencyBucket = 'LOW';

      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        builderId: invoice.builderId,
        balanceDue: Number(invoice.balanceDue),
        status: invoice.status,
        paymentTerm: invoice.paymentTerm,
        daysOverdue,
        companyName: invoice.companyName,
        contactName: invoice.contactName,
        email: invoice.email,
        phone: invoice.phone,
        dueDate: invoice.dueDate,
        urgencyBucket,
        priorityScore: Math.round(priorityScore * 100) / 100,
        scoreBreakdown: {
          amountFactor: Math.round(amountFactor * 100) / 100,
          daysOverdueFactor: Math.round(daysOverdueFactor * 100) / 100,
          paymentHistoryFactor: Math.round(paymentHistoryFactor * 100) / 100,
          termAdjustment: Math.round(termAdjustment * 100) / 100,
        },
      };
    });

    // Sort by priority score
    scoredInvoices.sort((a, b) => b.priorityScore - a.priorityScore);

    // Calculate aging buckets
    const agingBuckets = {
      current: scoredInvoices.filter((i) => i.daysOverdue <= 0),
      '1-30': scoredInvoices.filter(
        (i) => i.daysOverdue > 0 && i.daysOverdue <= 30
      ),
      '31-60': scoredInvoices.filter(
        (i) => i.daysOverdue > 30 && i.daysOverdue <= 60
      ),
      '61-90': scoredInvoices.filter(
        (i) => i.daysOverdue > 60 && i.daysOverdue <= 90
      ),
      '90+': scoredInvoices.filter((i) => i.daysOverdue > 90),
    };

    // Calculate summary statistics
    const totalAR = scoredInvoices.reduce((sum, i) => sum + i.balanceDue, 0);
    const overdueDaysThreshold = 0;
    const overdueScoredInvoices = scoredInvoices.filter(
      (i) => i.daysOverdue > overdueDaysThreshold
    );
    const totalOverdue = overdueScoredInvoices.reduce(
      (sum, i) => sum + i.balanceDue,
      0
    );

    // Calculate DSO (Days Sales Outstanding)
    const totalInvoices = outstandingInvoices.length;
    const avgDSO =
      totalInvoices > 0
        ? Math.round(
            scoredInvoices.reduce((sum, i) => sum + i.daysOverdue, 0) /
              totalInvoices
          )
        : 0;

    const summary = {
      totalAccountsReceivable: Math.round(totalAR * 100) / 100,
      totalOverdue: Math.round(totalOverdue * 100) / 100,
      averageDSO: avgDSO,
      invoiceCount: totalInvoices,
      criticalCount: agingBuckets['90+'].length,
      highCount: agingBuckets['61-90'].length,
    };

    return safeJson({
      success: true,
      summary,
      prioritizedActions: scoredInvoices.slice(0, 50),
      agingBuckets,
      builderProfiles: Array.from(statsMap.values()).map((stat) => ({
        builderId: stat.builderId,
        totalInvoices: stat.totalInvoices,
        avgPaymentDays: stat.avgPaymentDays || 0,
        medianPaymentDays: stat.medianPaymentDays || 0,
        onTimeRate: stat.totalInvoices > 0 ? Number((stat.onTimeCount / stat.totalInvoices).toFixed(2)) : 0,
      })),
    });
  } catch (error) {
    console.error('Collections GET error:', error);
    return safeJson({ error: 'Failed to retrieve collections data', details: String((error as any)?.message || error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  let body: any;
  try {
    // Audit log
    audit(request, 'CREATE', 'CashFlowOptimizer', undefined, { method: 'POST' }).catch(() => {})

    body = await request.json();
  } catch {
    return safeJson({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, actionId, status, response, builderId } = body;

  try {
    if (action === 'generate_actions') {
      // Analyze overdue invoices and create collection actions
      const overdueInvoices = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          i."id",
          i."invoiceNumber",
          i."builderId",
          (i."total" - COALESCE(i."amountPaid",0))::float AS "balanceDue",
          i."paymentTerm",
          i."dueDate",
          b."companyName",
          b."creditLimit",
          CURRENT_DATE - i."dueDate" as "daysOverdue",
          COALESCE((
            SELECT COUNT(*)::int FROM "CollectionAction"
            WHERE "invoiceId" = i."id"
          ), 0) as "existingActionCount"
        FROM "Invoice" i
        JOIN "Builder" b ON i."builderId" = b."id"
        WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
          AND CURRENT_DATE > i."dueDate"
          AND (i."total" - COALESCE(i."amountPaid",0)) > 0
        ORDER BY ((i."total" - COALESCE(i."amountPaid",0)) * (CURRENT_DATE - i."dueDate")) DESC
      `);

      const createdActions = [];

      for (const invoice of overdueInvoices) {
        const daysOverdue = invoice.daysOverdue || 0;

        // Skip if action already exists
        if (invoice.existingActionCount > 0) continue;

        let priority = 'MEDIUM';
        let urgency = 'STANDARD';
        let channel = 'EMAIL';

        if (daysOverdue > 60) {
          priority = 'CRITICAL';
          urgency = 'URGENT';
          channel = 'PHONE';
        } else if (daysOverdue > 30) {
          priority = 'HIGH';
          urgency = 'ESCALATED';
          channel = 'EMAIL';
        }

        const aiReasoning =
          `Invoice overdue by ${daysOverdue} days. Amount: $${invoice.balanceDue}. ` +
          `Payment term: ${invoice.paymentTerm}. ` +
          `Recommended action: ${channel === 'PHONE' ? 'Direct contact required' : 'Send payment reminder'}`;

        const result = await prisma.$executeRawUnsafe(
          `INSERT INTO "CollectionAction"
            ("invoiceId", "builderId", "actionType", "priority", "urgency", "amountDue", "daysOverdue",
             "channel", "status", "escalationLevel", "aiReasoning", "aiConfidence", "scheduledAt", "createdAt", "updatedAt")
           VALUES ($1, $2, 'COLLECT_PAYMENT', $3, $4, $5, $6, $7, 'PENDING', $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          invoice.id,
          invoice.builderId,
          priority,
          urgency,
          Number(invoice.balanceDue),
          daysOverdue,
          channel,
          daysOverdue > 60 ? 3 : daysOverdue > 30 ? 2 : 1,
          aiReasoning,
          daysOverdue > 60 ? 0.95 : daysOverdue > 30 ? 0.85 : 0.75
        );

        createdActions.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          builderId: invoice.builderId,
          priority,
          urgency,
          channel,
        });
      }

      return safeJson({
        success: true,
        message: `Created ${createdActions.length} collection actions`,
        actions: createdActions,
      });
    } else if (action === 'update_action') {
      if (!actionId || !status) {
        return safeJson({ error: 'Missing actionId or status' }, { status: 400 });
      }

      const result = await prisma.$executeRawUnsafe(
        `UPDATE "CollectionAction"
         SET "status" = $1, "response" = $2, "executedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $3`,
        status,
        response || null,
        actionId
      );

      return safeJson({
        success: true,
        message: 'Collection action updated',
      });
    } else if (action === 'analyze_builder') {
      if (!builderId) {
        return safeJson({ error: 'Missing builderId' }, { status: 400 });
      }

      // Deep analysis of builder payment behavior
      const builderAnalysis = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          b."id",
          b."companyName",
          b."accountBalance",
          b."creditLimit",
          COUNT(i."id")::int as "totalInvoices",
          SUM(CASE WHEN i."status"::text = 'PAID' THEN 1 ELSE 0 END)::int as "paidInvoices",
          AVG(EXTRACT(DAY FROM (COALESCE(i."paidAt", CURRENT_TIMESTAMP) - i."issuedAt")))::int as "avgPaymentDays",
          SUM(CASE WHEN i."paidAt" > i."dueDate" THEN 1 ELSE 0 END)::int as "latePaymentCount",
          SUM(i."total")::numeric as "totalRevenue",
          SUM(CASE WHEN i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE') THEN (i."total" - COALESCE(i."amountPaid",0)) ELSE 0 END)::numeric as "outstandingBalance"
        FROM "Builder" b
        LEFT JOIN "Invoice" i ON b."id" = i."builderId"
        WHERE b."id" = $1
        GROUP BY b."id", b."companyName", b."accountBalance", b."creditLimit"
      `,
      builderId
      );

      if (builderAnalysis.length === 0) {
        return safeJson({ error: 'Builder not found' }, { status: 404 });
      }

      const analysis = builderAnalysis[0];
      const onTimeRate =
        analysis.totalInvoices > 0
          ? (analysis.paidInvoices - analysis.latePaymentCount) /
            analysis.paidInvoices
          : 1;

      // Determine credit risk
      let creditRisk = 'LOW';
      if (onTimeRate < 0.6) creditRisk = 'HIGH';
      else if (onTimeRate < 0.8) creditRisk = 'MEDIUM';

      // Recommend payment terms
      let recommendedTerms = analysis.paymentTerm || 'NET_30';
      if (onTimeRate < 0.7) recommendedTerms = 'PAY_ON_DELIVERY';
      else if (onTimeRate < 0.85) recommendedTerms = 'NET_15';

      const projectedCollectionDate =
        analysis.avgPaymentDays > 0
          ? new Date(Date.now() + analysis.avgPaymentDays * 86400000)
            .toISOString()
            .split('T')[0]
          : null;

      // Update or create PaymentOptimization record
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PaymentOptimization"
          ("builderId", "avgPaymentDays", "medianPaymentDays", "onTimeRate", "latePaymentCount",
           "totalInvoices", "totalRevenue", "outstandingBalance", "creditRisk", "recommendedTerms",
           "earlyPayDiscountEligible", "projectedCollectionDate", "lastAnalyzedAt", "updatedAt")
         VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT ("builderId") DO UPDATE SET
           "avgPaymentDays" = $2,
           "onTimeRate" = $3,
           "latePaymentCount" = $4,
           "totalInvoices" = $5,
           "totalRevenue" = $6,
           "outstandingBalance" = $7,
           "creditRisk" = $8,
           "recommendedTerms" = $9,
           "lastAnalyzedAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP`,
        builderId,
        analysis.avgPaymentDays || 0,
        onTimeRate,
        analysis.latePaymentCount || 0,
        analysis.totalInvoices,
        Number(analysis.totalRevenue) || 0,
        Number(analysis.outstandingBalance) || 0,
        creditRisk,
        recommendedTerms,
        onTimeRate > 0.95,
        projectedCollectionDate
      );

      return safeJson({
        success: true,
        analysis: {
          builderId: analysis.id,
          companyName: analysis.companyName,
          totalInvoices: analysis.totalInvoices,
          paidInvoices: analysis.paidInvoices,
          avgPaymentDays: analysis.avgPaymentDays || 0,
          onTimeRate: Number((onTimeRate * 100).toFixed(2)),
          latePaymentCount: analysis.latePaymentCount || 0,
          totalRevenue: Number(analysis.totalRevenue) || 0,
          outstandingBalance: Number(analysis.outstandingBalance) || 0,
          creditRisk,
          recommendedTerms,
          projectedCollectionDate,
        },
      });
    } else {
      return safeJson({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Collections POST error:', error);
    return safeJson({ error: 'Failed to process collections action' }, { status: 500 });
  }
}
