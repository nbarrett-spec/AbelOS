export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { audit } from '@/lib/audit'

// Migration: Add onDelete cascade/setNull/restrict to all foreign keys
// This matches the updated Prisma schema

const migrations = [
  // ─── CASCADE DELETES (child records auto-delete with parent) ───

  // Blueprint → Project
  `ALTER TABLE "Blueprint" DROP CONSTRAINT IF EXISTS "Blueprint_projectId_fkey";
   ALTER TABLE "Blueprint" ADD CONSTRAINT "Blueprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // Takeoff → Project, Blueprint
  `ALTER TABLE "Takeoff" DROP CONSTRAINT IF EXISTS "Takeoff_projectId_fkey";
   ALTER TABLE "Takeoff" ADD CONSTRAINT "Takeoff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,
  `ALTER TABLE "Takeoff" DROP CONSTRAINT IF EXISTS "Takeoff_blueprintId_fkey";
   ALTER TABLE "Takeoff" ADD CONSTRAINT "Takeoff_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "Blueprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // Quote → Project, Takeoff
  `ALTER TABLE "Quote" DROP CONSTRAINT IF EXISTS "Quote_projectId_fkey";
   ALTER TABLE "Quote" ADD CONSTRAINT "Quote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,
  `ALTER TABLE "Quote" DROP CONSTRAINT IF EXISTS "Quote_takeoffId_fkey";
   ALTER TABLE "Quote" ADD CONSTRAINT "Quote_takeoffId_fkey" FOREIGN KEY ("takeoffId") REFERENCES "Takeoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // BomEntry → Product (both parent and component)
  `ALTER TABLE "BomEntry" DROP CONSTRAINT IF EXISTS "BomEntry_parentId_fkey";
   ALTER TABLE "BomEntry" ADD CONSTRAINT "BomEntry_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,
  `ALTER TABLE "BomEntry" DROP CONSTRAINT IF EXISTS "BomEntry_componentId_fkey";
   ALTER TABLE "BomEntry" ADD CONSTRAINT "BomEntry_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // BuilderPricing → Builder, Product
  `ALTER TABLE "BuilderPricing" DROP CONSTRAINT IF EXISTS "BuilderPricing_builderId_fkey";
   ALTER TABLE "BuilderPricing" ADD CONSTRAINT "BuilderPricing_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,
  `ALTER TABLE "BuilderPricing" DROP CONSTRAINT IF EXISTS "BuilderPricing_productId_fkey";
   ALTER TABLE "BuilderPricing" ADD CONSTRAINT "BuilderPricing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // UpgradePath → Product (from/to)
  `ALTER TABLE "UpgradePath" DROP CONSTRAINT IF EXISTS "UpgradePath_fromProductId_fkey";
   ALTER TABLE "UpgradePath" ADD CONSTRAINT "UpgradePath_fromProductId_fkey" FOREIGN KEY ("fromProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,
  `ALTER TABLE "UpgradePath" DROP CONSTRAINT IF EXISTS "UpgradePath_toProductId_fkey";
   ALTER TABLE "UpgradePath" ADD CONSTRAINT "UpgradePath_toProductId_fkey" FOREIGN KEY ("toProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // HomeownerAccess → Builder, Project
  `ALTER TABLE "HomeownerAccess" DROP CONSTRAINT IF EXISTS "HomeownerAccess_builderId_fkey";
   ALTER TABLE "HomeownerAccess" ADD CONSTRAINT "HomeownerAccess_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,
  `ALTER TABLE "HomeownerAccess" DROP CONSTRAINT IF EXISTS "HomeownerAccess_projectId_fkey";
   ALTER TABLE "HomeownerAccess" ADD CONSTRAINT "HomeownerAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // HomeownerSelection → HomeownerAccess
  `ALTER TABLE "HomeownerSelection" DROP CONSTRAINT IF EXISTS "HomeownerSelection_homeownerAccessId_fkey";
   ALTER TABLE "HomeownerSelection" ADD CONSTRAINT "HomeownerSelection_homeownerAccessId_fkey" FOREIGN KEY ("homeownerAccessId") REFERENCES "HomeownerAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // DecisionNote → Job
  `ALTER TABLE "DecisionNote" DROP CONSTRAINT IF EXISTS "DecisionNote_jobId_fkey";
   ALTER TABLE "DecisionNote" ADD CONSTRAINT "DecisionNote_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // Activity → Job (cascade when job deleted)
  `ALTER TABLE "Activity" DROP CONSTRAINT IF EXISTS "Activity_jobId_fkey";
   ALTER TABLE "Activity" ADD CONSTRAINT "Activity_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // Task → Job (cascade when job deleted)
  `ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_jobId_fkey";
   ALTER TABLE "Task" ADD CONSTRAINT "Task_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // ScheduleEntry → Job
  `ALTER TABLE "ScheduleEntry" DROP CONSTRAINT IF EXISTS "ScheduleEntry_jobId_fkey";
   ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // CrewMember → Crew, Staff
  `ALTER TABLE "CrewMember" DROP CONSTRAINT IF EXISTS "CrewMember_crewId_fkey";
   ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,
  `ALTER TABLE "CrewMember" DROP CONSTRAINT IF EXISTS "CrewMember_staffId_fkey";
   ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // Delivery → Job
  `ALTER TABLE "Delivery" DROP CONSTRAINT IF EXISTS "Delivery_jobId_fkey";
   ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // Installation → Job
  `ALTER TABLE "Installation" DROP CONSTRAINT IF EXISTS "Installation_jobId_fkey";
   ALTER TABLE "Installation" ADD CONSTRAINT "Installation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // QualityCheck → Job
  `ALTER TABLE "QualityCheck" DROP CONSTRAINT IF EXISTS "QualityCheck_jobId_fkey";
   ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // VendorProduct → Vendor
  `ALTER TABLE "VendorProduct" DROP CONSTRAINT IF EXISTS "VendorProduct_vendorId_fkey";
   ALTER TABLE "VendorProduct" ADD CONSTRAINT "VendorProduct_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // Payment → Invoice
  `ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_invoiceId_fkey";
   ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // MaterialPick → Job
  `ALTER TABLE "MaterialPick" DROP CONSTRAINT IF EXISTS "MaterialPick_jobId_fkey";
   ALTER TABLE "MaterialPick" ADD CONSTRAINT "MaterialPick_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // Notification → Staff
  `ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_staffId_fkey";
   ALTER TABLE "Notification" ADD CONSTRAINT "Notification_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // ConversationParticipant → Staff (cascade — remove from conversations)
  `ALTER TABLE "ConversationParticipant" DROP CONSTRAINT IF EXISTS "ConversationParticipant_staffId_fkey";
   ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,

  // ─── SET NULL (optional FK nulled when parent deleted) ───

  // Job → Order (keep job if order deleted)
  `ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_orderId_fkey";
   ALTER TABLE "Job" ADD CONSTRAINT "Job_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,

  // Job → Staff (assignedPM)
  `ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_assignedPMId_fkey";
   ALTER TABLE "Job" ADD CONSTRAINT "Job_assignedPMId_fkey" FOREIGN KEY ("assignedPMId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,

  // Order → Quote (keep order if quote deleted)
  `ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_quoteId_fkey";
   ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,

  // ScheduleEntry → Crew
  `ALTER TABLE "ScheduleEntry" DROP CONSTRAINT IF EXISTS "ScheduleEntry_crewId_fkey";
   ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,

  // Delivery → Crew
  `ALTER TABLE "Delivery" DROP CONSTRAINT IF EXISTS "Delivery_crewId_fkey";
   ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,

  // Installation → Crew
  `ALTER TABLE "Installation" DROP CONSTRAINT IF EXISTS "Installation_crewId_fkey";
   ALTER TABLE "Installation" ADD CONSTRAINT "Installation_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,

  // PurchaseOrder → Staff (approver)
  `ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_approvedById_fkey";
   ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,

  // TakeoffItem → Product (keep takeoff item if product deleted)
  `ALTER TABLE "TakeoffItem" DROP CONSTRAINT IF EXISTS "TakeoffItem_productId_fkey";
   ALTER TABLE "TakeoffItem" ADD CONSTRAINT "TakeoffItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,

  // Contract → Deal
  `ALTER TABLE "Contract" DROP CONSTRAINT IF EXISTS "Contract_dealId_fkey";
   ALTER TABLE "Contract" ADD CONSTRAINT "Contract_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,

  // DocumentRequest → Deal
  `ALTER TABLE "DocumentRequest" DROP CONSTRAINT IF EXISTS "DocumentRequest_dealId_fkey";
   ALTER TABLE "DocumentRequest" ADD CONSTRAINT "DocumentRequest_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,

  // BTProjectMapping → Builder, Job
  `ALTER TABLE "BTProjectMapping" DROP CONSTRAINT IF EXISTS "BTProjectMapping_builderId_fkey";
   ALTER TABLE "BTProjectMapping" ADD CONSTRAINT "BTProjectMapping_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,
  `ALTER TABLE "BTProjectMapping" DROP CONSTRAINT IF EXISTS "BTProjectMapping_jobId_fkey";
   ALTER TABLE "BTProjectMapping" ADD CONSTRAINT "BTProjectMapping_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,

  // ─── RESTRICT (prevent delete if children exist) ───

  // Project → Builder
  `ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_builderId_fkey";
   ALTER TABLE "Project" ADD CONSTRAINT "Project_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // Order → Builder
  `ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_builderId_fkey";
   ALTER TABLE "Order" ADD CONSTRAINT "Order_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // QuoteItem → Product
  `ALTER TABLE "QuoteItem" DROP CONSTRAINT IF EXISTS "QuoteItem_productId_fkey";
   ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // OrderItem → Product
  `ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_productId_fkey";
   ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // DecisionNote → Staff (author)
  `ALTER TABLE "DecisionNote" DROP CONSTRAINT IF EXISTS "DecisionNote_authorId_fkey";
   ALTER TABLE "DecisionNote" ADD CONSTRAINT "DecisionNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // Activity → Staff
  `ALTER TABLE "Activity" DROP CONSTRAINT IF EXISTS "Activity_staffId_fkey";
   ALTER TABLE "Activity" ADD CONSTRAINT "Activity_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // Task → Staff (assignee & creator)
  `ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_assigneeId_fkey";
   ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,
  `ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_creatorId_fkey";
   ALTER TABLE "Task" ADD CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // QualityCheck → Staff (inspector)
  `ALTER TABLE "QualityCheck" DROP CONSTRAINT IF EXISTS "QualityCheck_inspectorId_fkey";
   ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // PurchaseOrder → Vendor, Staff (creator)
  `ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_vendorId_fkey";
   ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,
  `ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_createdById_fkey";
   ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // Invoice → Staff (creator)
  `ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_createdById_fkey";
   ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // Message → Staff (sender)
  `ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_senderId_fkey";
   ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // Conversation → Staff (creator)
  `ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_createdById_fkey";
   ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // Deal → Staff (owner)
  `ALTER TABLE "Deal" DROP CONSTRAINT IF EXISTS "Deal_ownerId_fkey";
   ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // DealActivity → Staff
  `ALTER TABLE "DealActivity" DROP CONSTRAINT IF EXISTS "DealActivity_staffId_fkey";
   ALTER TABLE "DealActivity" ADD CONSTRAINT "DealActivity_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // Contract → Staff (creator)
  `ALTER TABLE "Contract" DROP CONSTRAINT IF EXISTS "Contract_createdById_fkey";
   ALTER TABLE "Contract" ADD CONSTRAINT "Contract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,

  // DocumentRequest → Staff (requester)
  `ALTER TABLE "DocumentRequest" DROP CONSTRAINT IF EXISTS "DocumentRequest_requestedById_fkey";
   ALTER TABLE "DocumentRequest" ADD CONSTRAINT "DocumentRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`,
];

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  audit(request, 'RUN_MIGRATE_CASCADES', 'Database', undefined, { migration: 'RUN_MIGRATE_CASCADES' }, 'CRITICAL').catch(() => {})

  try {
    const results: { index: number; stmt: number; status: string; error?: string }[] = [];

    for (let i = 0; i < migrations.length; i++) {
      // Split multi-statement strings into individual statements
      const statements = migrations[i]
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (let s = 0; s < statements.length; s++) {
        try {
          await prisma.$executeRawUnsafe(statements[s]);
          results.push({ index: i, stmt: s, status: 'OK' });
        } catch (err: any) {
          results.push({ index: i, stmt: s, status: 'ERROR', error: err.message?.slice(0, 200) });
        }
      }
    }

    const succeeded = results.filter(r => r.status === 'OK').length;
    const failed = results.filter(r => r.status === 'ERROR');

    return NextResponse.json({
      total: migrations.length,
      succeeded,
      failed: failed.length,
      errors: failed,
    });
  } catch (error: any) {
    console.error('Migration failed:', error);
    return NextResponse.json(
      { error: 'Migration failed'},
      { status: 500 }
    );
  }
}
