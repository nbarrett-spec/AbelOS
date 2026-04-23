export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { notifyDeliveryStatusChange } from '@/lib/notifications';
import { checkStaffAuth } from '@/lib/api-auth';
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const id = params.id;

    // Get delivery with related job and material picks
    const deliveryResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      jobId: string;
      deliveryNumber: string;
      status: string;
      address: string;
      departedAt: Date | null;
      arrivedAt: Date | null;
      completedAt: Date | null;
      loadPhotos: string | null;
      sitePhotos: string | null;
      signedBy: string | null;
      damageNotes: string | null;
      notes: string | null;
      jobNumber: string;
      builderName: string;
      builderContact: string;
      community: string | null;
      lotBlock: string | null;
    }>>(
      `SELECT d.*, j."jobNumber", j."builderName", j."builderContact", j.community, j."lotBlock"
       FROM "Delivery" d
       JOIN "Job" j ON d."jobId" = j.id
       WHERE d.id = $1`,
      id
    );

    if (!deliveryResult || deliveryResult.length === 0) {
      return NextResponse.json(
        { error: 'Delivery not found' },
        { status: 404 }
      );
    }

    const delivery = deliveryResult[0];

    // Get material picks for this job
    const materialPicksResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      sku: string;
      description: string;
      quantity: number;
    }>>(
      `SELECT id, sku, description, quantity FROM "MaterialPick" WHERE "jobId" = $1`,
      delivery.jobId
    );

    return NextResponse.json({
      id: delivery.id,
      jobId: delivery.jobId,
      deliveryNumber: delivery.deliveryNumber,
      status: delivery.status,
      address: delivery.address,
      job: {
        jobNumber: delivery.jobNumber,
        builderName: delivery.builderName,
        builderContact: delivery.builderContact,
        community: delivery.community,
        lotBlock: delivery.lotBlock,
      },
      departedAt: delivery.departedAt,
      arrivedAt: delivery.arrivedAt,
      completedAt: delivery.completedAt,
      loadPhotos: delivery.loadPhotos,
      sitePhotos: delivery.sitePhotos,
      signedBy: delivery.signedBy,
      damageNotes: delivery.damageNotes,
      notes: delivery.notes,
      materialPicks: materialPicksResult,
    });
  } catch (error) {
    console.error('Failed to get delivery:', error);
    return NextResponse.json(
      { error: 'Failed to get delivery' },
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
      signedBy,
      departedAt,
      arrivedAt,
      completedAt,
      damageNotes,
      loadPhotos,
      sitePhotos,
    } = body;

    // Get current delivery to check status changes
    const currentDeliveryResult = await prisma.$queryRawUnsafe<Array<{
      status: string;
      jobId: string;
    }>>(
      `SELECT status, "jobId" FROM "Delivery" WHERE id = $1`,
      id
    );

    const currentDelivery = currentDeliveryResult?.[0];

    // Guard: enforce DeliveryStatus state machine before writing status.
    if (status && currentDelivery && status !== currentDelivery.status) {
      try {
        requireValidTransition('delivery', currentDelivery.status, status);
      } catch (e) {
        const res = transitionErrorResponse(e);
        if (res) return res;
        throw e;
      }
    }

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
    if (signedBy !== undefined) {
      updates.push(`"signedBy" = $${paramIndex}`);
      values.push(signedBy);
      paramIndex++;
    }
    if (departedAt) {
      updates.push(`"departedAt" = $${paramIndex}`);
      values.push(new Date(departedAt));
      paramIndex++;
    }
    if (arrivedAt) {
      updates.push(`"arrivedAt" = $${paramIndex}`);
      values.push(new Date(arrivedAt));
      paramIndex++;
    }
    if (completedAt) {
      updates.push(`"completedAt" = $${paramIndex}`);
      values.push(new Date(completedAt));
      paramIndex++;
    }
    if (damageNotes !== undefined) {
      updates.push(`"damageNotes" = $${paramIndex}`);
      values.push(damageNotes);
      paramIndex++;
    }
    if (loadPhotos !== undefined) {
      updates.push(`"loadPhotos" = $${paramIndex}`);
      values.push(loadPhotos);
      paramIndex++;
    }
    if (sitePhotos !== undefined) {
      updates.push(`"sitePhotos" = $${paramIndex}`);
      values.push(sitePhotos);
      paramIndex++;
    }

    // Only execute update if there are changes
    if (updates.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Delivery" SET ${updates.join(', ')} WHERE id = $1`,
        ...values
      );
    }

    // Get updated delivery with related data
    const deliveryResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      jobId: string;
      deliveryNumber: string;
      status: string;
      address: string;
      departedAt: Date | null;
      arrivedAt: Date | null;
      completedAt: Date | null;
      signedBy: string | null;
      notes: string | null;
      damageNotes: string | null;
      jobNumber: string;
      builderName: string;
      builderContact: string;
      community: string | null;
      lotBlock: string | null;
      orderId: string | null;
    }>>(
      `SELECT d.*, j."jobNumber", j."builderName", j."builderContact", j.community, j."lotBlock", j."orderId"
       FROM "Delivery" d
       JOIN "Job" j ON d."jobId" = j.id
       WHERE d.id = $1`,
      id
    );

    const delivery = deliveryResult?.[0];

    if (!delivery) {
      return NextResponse.json(
        { error: 'Delivery not found' },
        { status: 404 }
      );
    }

    // Get material picks
    const materialPicksResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      sku: string;
      description: string;
      quantity: number;
    }>>(
      `SELECT id, sku, description, quantity FROM "MaterialPick" WHERE "jobId" = $1`,
      delivery.jobId
    );

    // Send automated delivery notification to builder
    if (status && currentDelivery && status !== currentDelivery.status) {
      notifyDeliveryStatusChange(id, status).catch(e =>
        console.error('[DELIVERY NOTIFY] Failed:', e.message)
      )
    }

    // Auto-create Invoice when delivery status transitions to COMPLETE
    if (status === 'COMPLETE' && currentDelivery && currentDelivery.status !== 'COMPLETE') {
      // Check if invoice already exists
      const existingInvoiceResult = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Invoice" WHERE "jobId" = $1 LIMIT 1`,
        currentDelivery.jobId
      );

      if (!existingInvoiceResult || existingInvoiceResult.length === 0) {
        if (delivery.orderId) {
          // Get order details
          const orderResult = await prisma.$queryRawUnsafe<Array<{
            id: string;
            builderId: string;
            subtotal: number;
            taxAmount: number | null;
            total: number;
            paymentTerm: string;
          }>>(
            `SELECT id, "builderId", subtotal, "taxAmount", total, "paymentTerm" FROM "Order" WHERE id = $1`,
            delivery.orderId
          );

          const order = orderResult?.[0];

          if (order) {
            // Generate invoiceNumber: "INV-YYYY-NNNN"
            const year = new Date().getFullYear();
            const lastInvoiceResult = await prisma.$queryRawUnsafe<Array<{
              invoiceNumber: string;
            }>>(
              `SELECT "invoiceNumber" FROM "Invoice" WHERE "invoiceNumber" LIKE $1 ORDER BY "invoiceNumber" DESC LIMIT 1`,
              `INV-${year}-%`
            );

            let nextNumber = 1;
            if (lastInvoiceResult && lastInvoiceResult.length > 0) {
              const lastNumber = parseInt(lastInvoiceResult[0].invoiceNumber.split('-')[2]);
              nextNumber = lastNumber + 1;
            }

            const invoiceNumber = `INV-${year}-${String(nextNumber).padStart(4, '0')}`;

            // Find a staff member to credit as creator (first ADMIN)
            const staffResult = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT id FROM "Staff" WHERE role = $1 LIMIT 1`,
              'ADMIN'
            );

            const createdById = staffResult?.[0]?.id || '';

            // Create invoice
            const invoiceId = crypto.randomUUID();
            const taxAmount = order.taxAmount || 0;

            await prisma.$executeRawUnsafe(
              `INSERT INTO "Invoice" (id, "invoiceNumber", "builderId", "jobId", "orderId", "createdById", status, subtotal, "taxAmount", total, "balanceDue", "amountPaid", "paymentTerm", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
              invoiceId,
              invoiceNumber,
              order.builderId,
              currentDelivery.jobId,
              delivery.orderId,
              createdById,
              'DRAFT',
              order.subtotal,
              taxAmount,
              order.total,
              order.total,
              0,
              order.paymentTerm
            );

            // Get order items
            const orderItemsResult = await prisma.$queryRawUnsafe<Array<{
              description: string;
              quantity: number;
              unitPrice: number;
              lineTotal: number;
              productId: string | null;
            }>>(
              `SELECT description, quantity, "unitPrice", "lineTotal", "productId" FROM "OrderItem" WHERE "orderId" = $1`,
              delivery.orderId
            );

            // Create invoice items
            for (const item of orderItemsResult || []) {
              const itemId = crypto.randomUUID();
              await prisma.$executeRawUnsafe(
                `INSERT INTO "InvoiceItem" (id, "invoiceId", description, quantity, "unitPrice", "lineTotal", "productId", "createdAt", "updatedAt")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
                itemId,
                invoiceId,
                item.description,
                item.quantity,
                item.unitPrice,
                item.lineTotal,
                item.productId
              );
            }
          }
        }
      }
    }

    return NextResponse.json({
      id: delivery.id,
      jobId: delivery.jobId,
      deliveryNumber: delivery.deliveryNumber,
      status: delivery.status,
      address: delivery.address,
      job: {
        jobNumber: delivery.jobNumber,
        builderName: delivery.builderName,
        builderContact: delivery.builderContact,
        community: delivery.community,
        lotBlock: delivery.lotBlock,
      },
      departedAt: delivery.departedAt,
      arrivedAt: delivery.arrivedAt,
      completedAt: delivery.completedAt,
      signedBy: delivery.signedBy,
      notes: delivery.notes,
      damageNotes: delivery.damageNotes,
      materialPicks: materialPicksResult,
    });
  } catch (error) {
    console.error('Failed to update delivery:', error);
    return NextResponse.json(
      { error: 'Failed to update delivery' },
      { status: 500 }
    );
  }
}
