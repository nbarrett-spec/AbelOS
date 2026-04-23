const { PrismaClient } = require('@prisma/client');
const { Client } = require('pg');
require('dotenv').config();

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const models = ['Job', 'PurchaseOrder', 'Invoice'];
  for (const m of models) {
    const res = await client.query(`SELECT column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [m]);
    console.log('=== ' + m + ' ===');
    res.rows.forEach(r => console.log(r.column_name + ' | ' + r.data_type + ' | ' + r.udt_name + ' | nullable=' + r.is_nullable + ' | default=' + (r.column_default || 'null')));
  }
  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
