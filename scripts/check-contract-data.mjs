import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];
const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);
const counts = await sql`SELECT count(*) as total FROM "Contract"`;
console.log('Contract total:', counts);
const orgs = await sql`SELECT DISTINCT "organizationId" FROM "Contract" LIMIT 5`;
console.log('Distinct orgs:', orgs);
// Check FKs in DB
const fks = await sql`
  SELECT tc.constraint_name, tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name IN ('Contract','Quote')
`;
console.log('FKs:', fks);
// Is there Organization table?
const orgTable = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='Organization'`;
console.log('Organization table exists:', orgTable.length > 0);
