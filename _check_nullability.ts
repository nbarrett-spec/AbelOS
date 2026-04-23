import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const rows: any[] = await p.$queryRawUnsafe(`
    SELECT table_name, column_name, is_nullable, data_type, column_default
    FROM information_schema.columns
    WHERE (table_name='Takeoff' AND column_name='blueprintId')
       OR (table_name='Message' AND column_name='senderId')
       OR (table_name='Conversation' AND column_name='createdById')
       OR (table_name='Contract' AND column_name='paymentTerm')
       OR (table_name='Contract' AND column_name='discountPercent')
       OR (table_name='IntegrationConfig' AND column_name='name')
    ORDER BY table_name, column_name
  `);
  console.log(JSON.stringify(rows, null, 2));

  // Also check for nulls in existing data
  const sanity: any[] = await p.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*) FROM "Takeoff" WHERE "blueprintId" IS NULL)::int AS takeoff_blueprintid_null,
      (SELECT COUNT(*) FROM "Message" WHERE "senderId" IS NULL)::int AS message_senderid_null,
      (SELECT COUNT(*) FROM "Conversation" WHERE "createdById" IS NULL)::int AS conversation_createdbyid_null,
      (SELECT COUNT(*) FROM "Contract" WHERE "paymentTerm" IS NULL)::int AS contract_paymentterm_null,
      (SELECT COUNT(*) FROM "Contract" WHERE "discountPercent" IS NULL)::int AS contract_discount_null,
      (SELECT COUNT(*) FROM "IntegrationConfig" WHERE "name" IS NULL)::int AS intconfig_name_null,
      (SELECT COUNT(*) FROM "Takeoff")::int AS takeoff_total,
      (SELECT COUNT(*) FROM "Message")::int AS message_total,
      (SELECT COUNT(*) FROM "Conversation")::int AS conversation_total,
      (SELECT COUNT(*) FROM "Contract")::int AS contract_total,
      (SELECT COUNT(*) FROM "IntegrationConfig")::int AS intconfig_total
  `);
  console.log('NULL COUNTS + TOTALS:');
  console.log(JSON.stringify(sanity, null, 2));

  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
