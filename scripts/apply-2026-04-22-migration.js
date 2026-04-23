// Apply 2026_04_22_create_missing_tables.sql against live DB.
// Splits on top-level semicolons while honoring $$ blocks so DO $$ ... $$;
// statements stay intact.

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

function splitSql(text) {
  // Strip -- line comments but preserve inside strings (we have none in ours)
  const stripped = text
    .split('\n')
    .map(l => (l.match(/^\s*--/) ? '' : l))
    .join('\n');

  const out = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < stripped.length; i++) {
    const two = stripped.slice(i, i + 2);
    if (two === '$$') {
      inDollar = !inDollar;
      buf += '$$';
      i++;
      continue;
    }
    const ch = stripped[i];
    if (ch === ';' && !inDollar) {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

(async () => {
  const sqlText = fs.readFileSync(
    path.join(__dirname, '..', 'prisma', 'migrations', '2026_04_22_create_missing_tables.sql'),
    'utf8'
  );
  const stmts = splitSql(sqlText);
  const sql = neon(process.env.DATABASE_URL);
  console.log(`Executing ${stmts.length} statements...`);
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 90);
    try {
      await sql.query(stmt);
      console.log(`  [${i + 1}/${stmts.length}] OK  ${preview}`);
    } catch (e) {
      console.error(`  [${i + 1}/${stmts.length}] FAIL ${preview}`);
      console.error('    ', e.message);
      process.exit(1);
    }
  }
  console.log('Migration applied.');
})();
