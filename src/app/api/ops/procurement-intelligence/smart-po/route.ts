export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';
import { audit } from '@/lib/audit'

// Smart PO Recommendations Engine
// AI-driven purchase order recommendations based on inventory, demand, and vendor performance

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const vendorId = searchParams.get('vendorId');
    const urgencyFilter = searchParams.get('urgency');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Get all active products with inventory
    const productsResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p."id",
        p."name",
        p."sku",
        p."active",
        COALESCE(i."onHand", 0) as onHand,
        COALESCE(i."committed", 0) as committed,
        COALESCE(i."onOrder", 0) as onOrder,
        COALESCE(i."available", 0) as available,
        COALESCE(i."reorderPoint", 0) as reorderPoint,
        COALESCE(i."reorderQty", 0) as reorderQty
      FROM "Product" p
      LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
      WHERE p."active" = true
      ORDER BY p."name"
    `);

    // Get upcoming order demand (next 30 days)
    const demandResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        oi."productId",
        SUM(oi."quantity")::int as demandQty
      FROM "Order" o
      JOIN "OrderItem" oi ON oi."orderId" = o."id"
      WHERE o."status" IN ($1::"OrderStatus", $2::"OrderStatus", $3::"OrderStatus")
      AND o."createdAt" >= NOW() - INTERVAL '30 days'
      GROUP BY oi."productId"
    `, 'RECEIVED', 'CONFIRMED', 'IN_PRODUCTION');

    const demandMap: Record<string, number> = {};
    demandResult.forEach((row: any) => {
      demandMap[row.productId] = row.demandQty || 0;
    });

    // Get existing open PO quantities
    const openPOsResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        poi."productId",
        SUM(CASE WHEN poi."receivedQty" IS NULL OR poi."receivedQty" = 0
                 THEN poi."quantity" - COALESCE(poi."receivedQty", 0)
                 ELSE 0 END)::int as onOrderQty
      FROM "PurchaseOrder" po
      JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
      WHERE po."status" IN ($1::"POStatus", $2::"POStatus", $3::"POStatus", $4::"POStatus")
      GROUP BY poi."productId"
    `, 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_VENDOR');

    const onOrderMap: Record<string, number> = {};
    openPOsResult.forEach((row: any) => {
      onOrderMap[row.productId] = row.onOrderQty || 0;
    });

    const recommendations: any[] = [];
    const consolidationGroups: Record<string, any[]> = {};
    let groupCounter = 0;

    // Analyze each product
    for (const product of productsResult) {
      const available = product.available;
      const committed = product.committed;
      const onOrder = onOrderMap[product.id] || 0;
      const demand = demandMap[product.id] || 0;
      const reorderPoint = product.reorderPoint || 0;
      const reorderQty = product.reorderQty || 0;

      // Check if we need to reorder
      const totalNeeded = committed + reorderPoint;
      const totalAvailable = available + onOrder;

      if (totalAvailable < totalNeeded) {
        // Find best vendor
        const vendorsResult: any[] = await prisma.$queryRawUnsafe(`
          SELECT
            vp."vendorId",
            v."name",
            v."code",
            vp."preferred",
            vp."vendorCost",
            vp."leadTimeDays",
            vs."overallScore",
            COALESCE(vs."onTimeRate", 0.85) as onTimeRate
          FROM "VendorProduct" vp
          JOIN "Vendor" v ON v."id" = vp."vendorId"
          LEFT JOIN "VendorScorecard" vs ON vs."vendorId" = v."id"
          WHERE vp."productId" = $1
          AND v."active" = true
          ORDER BY vp."preferred" DESC, vs."overallScore" DESC
          LIMIT 1
        `, product.id);

        if (vendorsResult.length === 0) continue;

        const vendor = vendorsResult[0];
        const leadTimeDays = vendor.leadTimeDays || 7;
        const orderByDate = new Date();
        orderByDate.setDate(orderByDate.getDate() + leadTimeDays + 2);

        const recommendedQty = Math.max(
          reorderQty,
          totalNeeded - available - onOrder
        );

        const estimatedCost = (vendor.vendorCost || 50) * recommendedQty;

        // Determine urgency
        let urgency = 'NORMAL';
        if (available <= reorderPoint / 2) {
          urgency = 'CRITICAL';
        } else if (available <= reorderPoint) {
          urgency = 'HIGH';
        } else if (demand > 0) {
          urgency = 'HIGH';
        }

        // Skip if doesn't match urgency filter
        if (urgencyFilter && urgency !== urgencyFilter) continue;

        // Skip if vendor filter doesn't match
        if (vendorId && vendor.vendorId !== vendorId) continue;

        // Create consolidation group
        let consolidationGroupId = null;
        if (!consolidationGroups[vendor.vendorId]) {
          consolidationGroupId = `CONS-${++groupCounter}`;
          consolidationGroups[vendor.vendorId] = [];
        } else {
          consolidationGroupId = `CONS-${Object.keys(consolidationGroups).indexOf(vendor.vendorId) + 1}`;
        }

        const rec = {
          vendorId: vendor.vendorId,
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          currentStock: product.onHand,
          committed,
          onOrder,
          recommendedQty,
          estimatedCost: Math.round(estimatedCost * 100) / 100,
          leadTimeDays,
          orderByDate: orderByDate.toISOString().split('T')[0],
          triggerReason:
            available <= reorderPoint / 2
              ? 'Critical stock level - below 50% reorder point'
              : available <= reorderPoint
              ? `Below reorder point for ${Math.ceil((totalNeeded - available) / recommendedQty)} upcoming deliveries`
              : `Proactive reorder to maintain ${reorderPoint} unit buffer`,
          urgency,
          consolidationGroupId,
        };

        consolidationGroups[vendor.vendorId].push(rec);
        recommendations.push(rec);

        if (recommendations.length >= limit) break;
      }
    }

    // Group by vendor and consolidation
    const groupedByVendor: Record<string, any> = {};

    for (const rec of recommendations) {
      if (!groupedByVendor[rec.vendorId]) {
        // Get vendor info
        const vendorResult: any[] = await prisma.$queryRawUnsafe(`
          SELECT
            "id",
            "name",
            "code"
          FROM "Vendor"
          WHERE "id" = $1
        `, rec.vendorId);

        // Get vendor score
        const scoreResult: any[] = await prisma.$queryRawUnsafe(`
          SELECT "overallScore"
          FROM "VendorScorecard"
          WHERE "vendorId" = $1
        `, rec.vendorId);

        const vendorData = vendorResult[0];
        const score = scoreResult[0]?.overallScore || 0;

        groupedByVendor[rec.vendorId] = {
          vendorId: rec.vendorId,
          vendor: {
            id: vendorData.id,
            name: vendorData.name,
            code: vendorData.code,
            score: Math.round(score * 100) / 100,
          },
          items: [],
          totalEstimatedCost: 0,
          estimatedSavings: 0,
          urgency: 'NORMAL',
          consolidationGroupId: rec.consolidationGroupId,
        };
      }

      groupedByVendor[rec.vendorId].items.push({
        productId: rec.productId,
        sku: rec.sku,
        productName: rec.productName,
        currentStock: rec.currentStock,
        committed: rec.committed,
        onOrder: rec.onOrder,
        recommendedQty: rec.recommendedQty,
        estimatedCost: rec.estimatedCost,
        leadTimeDays: rec.leadTimeDays,
        orderByDate: rec.orderByDate,
        triggerReason: rec.triggerReason,
      });

      groupedByVendor[rec.vendorId].totalEstimatedCost += rec.estimatedCost;
      groupedByVendor[rec.vendorId].urgency = rec.urgency;
    }

    // Convert to array and calculate savings
    const finalRecommendations = Object.values(groupedByVendor).map((group: any) => {
      let savingsReason = '';
      let estimatedSavings = 0;

      if (group.totalEstimatedCost > 2000) {
        estimatedSavings = group.totalEstimatedCost * 0.05;
        savingsReason = 'Bulk order discount (>$2000)';
      }

      return {
        id: `REC-${Math.random().toString(36).substring(7)}`,
        vendor: group.vendor,
        items: group.items,
        totalEstimatedCost: Math.round(group.totalEstimatedCost * 100) / 100,
        estimatedSavings: Math.round(estimatedSavings * 100) / 100,
        savingsReason,
        urgency: group.urgency,
        consolidationGroupId: group.consolidationGroupId,
      };
    });

    // Sort by urgency
    const urgencyOrder = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    finalRecommendations.sort(
      (a: any, b: any) =>
        (urgencyOrder as any)[a.urgency] - (urgencyOrder as any)[b.urgency]
    );

    // Calculate summary
    const totalSpend = finalRecommendations.reduce(
      (sum: number, rec: any) => sum + rec.totalEstimatedCost,
      0
    );
    const totalSavings = finalRecommendations.reduce(
      (sum: number, rec: any) => sum + rec.estimatedSavings,
      0
    );

    const criticalCount = finalRecommendations.filter(
      (r: any) => r.urgency === 'CRITICAL'
    ).length;

    const nextDeadline =
      finalRecommendations.length > 0
        ? finalRecommendations.find((r: any) => r.urgency === 'CRITICAL' || r.urgency === 'HIGH')
            ?.items?.[0]?.orderByDate || new Date().toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

    return safeJson({
      recommendations: finalRecommendations,
      summary: {
        totalRecommendations: finalRecommendations.length,
        criticalItems: criticalCount,
        totalEstimatedSpend: Math.round(totalSpend * 100) / 100,
        potentialSavings: Math.round(totalSavings * 100) / 100,
        nextDeadline,
      },
    });
  } catch (error: any) {
    console.error('Smart PO GET error:', error);
    return safeJson(
      {
        error: 'Failed to generate PO recommendations',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    // Audit log
    audit(request, 'CREATE', 'ProcurementIntelligence', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json();
    const { action, recommendationIds, modifications } = body;

    if (
      !['approve', 'reject', 'modify', 'convert_to_po'].includes(action)
    ) {
      return safeJson(
        {
          error: 'Invalid action. Use: approve, reject, modify, or convert_to_po',
        },
        { status: 400 }
      );
    }

    if (!recommendationIds || !Array.isArray(recommendationIds)) {
      return safeJson(
        { error: 'recommendationIds must be an array' },
        { status: 400 }
      );
    }

    const placeholders = recommendationIds
      .map((_, i) => `$${i + 1}`)
      .join(',');

    let affectedCount = 0;

    if (action === 'convert_to_po') {
      // Get recommendation details
      const recsResult: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          "id",
          "vendorId",
          "productId",
          "recommendedQty",
          "estimatedCost"
        FROM "SmartPORecommendation"
        WHERE "id" IN (${placeholders})
      `, ...recommendationIds);

      for (const rec of recsResult) {
        // Create PurchaseOrder
        const poId = (Math.random().toString(36) + Date.now().toString(36)).substr(2, 9);
        const poNumber = `PO-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        // Get current staff user (simplified - should come from auth context)
        const staffResult: any[] = await prisma.$queryRawUnsafe(`
          SELECT "id" FROM "Staff" LIMIT 1
        `);

        const createdById = staffResult[0]?.id || 'system';

        await prisma.$executeRawUnsafe(`
          INSERT INTO "PurchaseOrder" (
            "id", "poNumber", "vendorId", "createdById", "status",
            "subtotal", "total", "orderedAt", "aiGenerated",
            "recommendationId", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, NOW(), true, $8, NOW(), NOW()
          )
        `,
        poId,
        poNumber,
        rec.vendorId,
        createdById,
        'DRAFT',
        rec.estimatedCost,
        rec.estimatedCost,
        rec.id
        );

        // Create PurchaseOrderItem
        const itemId = (Math.random().toString(36) + Date.now().toString(36)).substr(
          2,
          9
        );

        // Get product info
        const productResult: any[] = await prisma.$queryRawUnsafe(`
          SELECT "sku", "name" FROM "Product" WHERE "id" = $1
        `, rec.productId);

        const product = productResult[0];
        const unitCost = rec.estimatedCost / rec.recommendedQty;

        await prisma.$executeRawUnsafe(`
          INSERT INTO "PurchaseOrderItem" (
            "id", "purchaseOrderId", "productId", "vendorSku",
            "description", "quantity", "unitCost", "lineTotal", "createdAt"
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, NOW()
          )
        `,
        itemId,
        poId,
        rec.productId,
        product?.sku || 'UNKNOWN',
        product?.name || 'Unknown Product',
        rec.recommendedQty,
        Math.round(unitCost * 100) / 100,
        rec.estimatedCost
        );

        // Update recommendation status
        await prisma.$executeRawUnsafe(`
          UPDATE "SmartPORecommendation"
          SET "status" = $1, "convertedPOId" = $2, "updatedAt" = NOW()
          WHERE "id" = $3
        `, 'CONVERTED', poId, rec.id);

        affectedCount++;
      }
    } else if (action === 'approve') {
      // Get current user ID (simplified)
      const staffResult: any[] = await prisma.$queryRawUnsafe(`
        SELECT "id" FROM "Staff" LIMIT 1
      `);
      const approvedById = staffResult[0]?.id || 'system';

      await prisma.$executeRawUnsafe(`
        UPDATE "SmartPORecommendation"
        SET "status" = $1, "approvedById" = $2, "approvedAt" = NOW(), "updatedAt" = NOW()
        WHERE "id" IN (${placeholders})
      `, 'APPROVED', approvedById, ...recommendationIds);

      affectedCount = recommendationIds.length;
    } else if (action === 'reject') {
      await prisma.$executeRawUnsafe(`
        UPDATE "SmartPORecommendation"
        SET "status" = $1, "updatedAt" = NOW()
        WHERE "id" IN (${placeholders})
      `, 'REJECTED', ...recommendationIds);

      affectedCount = recommendationIds.length;
    } else if (action === 'modify') {
      // modifications object should have id -> { recommendedQty, estimatedCost } pairs
      if (!modifications || typeof modifications !== 'object') {
        return safeJson(
          { error: 'modifications must be an object with rec IDs as keys' },
          { status: 400 }
        );
      }

      for (const recId of recommendationIds) {
        const mod = modifications[recId];
        if (!mod) continue;

        const updates: string[] = [];
        const values: any[] = [];
        let paramNum = 1;

        if (mod.recommendedQty !== undefined) {
          updates.push(`"recommendedQty" = $${paramNum++}`);
          values.push(mod.recommendedQty);
        }

        if (mod.estimatedCost !== undefined) {
          updates.push(`"estimatedCost" = $${paramNum++}`);
          values.push(mod.estimatedCost);
        }

        if (updates.length === 0) continue;

        updates.push(`"updatedAt" = NOW()`);

        await prisma.$executeRawUnsafe(`
          UPDATE "SmartPORecommendation"
          SET ${updates.join(', ')}
          WHERE "id" = $${paramNum}
        `, ...values, recId);

        affectedCount++;
      }
    }

    return safeJson({
      success: true,
      action,
      affectedCount,
    });
  } catch (error: any) {
    console.error('Smart PO POST error:', error);
    return safeJson(
      {
        error: 'Failed to process PO action',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
