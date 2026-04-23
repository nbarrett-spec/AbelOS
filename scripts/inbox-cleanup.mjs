// ─────────────────────────────────────────────────────────────────────────────
// inbox-cleanup.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Cleans InboxItem so the team will actually open it again.
//
// Six operations, applied in order:
//   1. Merge dupes within (type, entityId) groups — keep earliest, resolve rest
//      as outcome='merged-dupe', roll mergedFromCount onto the survivor.
//   2. Collapse 31 HW PPTX slide rows → one rollup row.
//   3. Drop empty "[PIPELINE]" $0/35% deal rows with null entityId
//      (outcome='routed-to-deal-table').
//   4. Auto-resolve SYSTEM_AUDIT_FINDING (outcome='auto-historical').
//   5. Auto-resolve IMPROVEMENT_* (outcome='strategic-plan-moved').
//   6. Auto-resolve Pulte Below-cost pricing alerts (customer lost 4/20/26).
//
// Then routes still-PENDING items via assignedTo rules.
//
// USAGE:
//   node scripts/inbox-cleanup.mjs            # DRY RUN — report only, no writes
//   node scripts/inbox-cleanup.mjs --commit   # APPLY
//
// Does NOT modify prisma/schema.prisma or InboxItem schema — writes to existing
// columns only (status, resolvedAt, resolvedBy, result, assignedTo, actionData,
// updatedAt).
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const COMMIT = process.argv.includes('--commit');
const CLEANUP_MARKER = 'inbox-cleanup-2026-04-23';
const NATE = 'n.barrett@abellumber.com';
const CLINT = 'c.vinson@abellumber.com';
const DALTON = 'dalton@abellumber.com';

function bar(s) { console.log('\n' + '═'.repeat(72) + '\n  ' + s + '\n' + '═'.repeat(72)); }
function sub(s) { console.log('\n─── ' + s); }
function mode() { return COMMIT ? 'COMMIT' : 'DRY-RUN'; }

// Shared result-payload helper: we stamp the reason + marker so this script's
// work is trivially identifiable later.
function resultJson(outcome, extra = {}) {
  return JSON.stringify({ outcome, marker: CLEANUP_MARKER, at: new Date().toISOString(), ...extra });
}

// ─── Snapshot: before ───────────────────────────────────────────────────────
async function snapshot(label) {
  bar(`Snapshot — ${label}`);
  const total = (await sql`SELECT COUNT(*)::int AS c FROM "InboxItem" WHERE status='PENDING'`)[0].c;
  const byType = await sql`
    SELECT type, COUNT(*)::int AS c FROM "InboxItem"
    WHERE status='PENDING' GROUP BY type ORDER BY c DESC
  `;
  const assign = (await sql`
    SELECT COUNT(*) FILTER (WHERE "assignedTo" IS NOT NULL)::int AS assigned,
           COUNT(*)::int AS total
    FROM "InboxItem" WHERE status='PENDING'
  `)[0];
  console.log(`total PENDING: ${total}`);
  console.table(byType);
  console.log(`assignedTo coverage: ${assign.assigned}/${assign.total}` +
    (assign.total ? ` (${((assign.assigned/assign.total)*100).toFixed(1)}%)` : ''));
  return { total, byType, assign };
}

// ─── Op 1: merge dupes ──────────────────────────────────────────────────────
async function op1_mergeDupes() {
  bar('Op 1 — Merge dupes across (type, entityId) groups');
  // Find all PENDING dupe groups. Keep earliest createdAt as survivor.
  const groups = await sql`
    SELECT type, "entityId", COUNT(*)::int AS c
    FROM "InboxItem"
    WHERE status='PENDING' AND "entityId" IS NOT NULL
    GROUP BY type, "entityId"
    HAVING COUNT(*) > 1
  `;
  // Exclude HW PPTX group — that's handled in Op 2 with a custom rollup title.
  const dupeGroups = groups.filter(g => !(g.type === 'AGENT_TASK' && g.entityId === 'HW_PITCH_PPTX_APR2026'));
  let survivors = 0, resolvedExtras = 0;
  sub(`${dupeGroups.length} groups (excluding HW PPTX), totaling ${dupeGroups.reduce((a,g)=>a+g.c,0)} rows`);
  console.log('sample groups:', dupeGroups.slice(0, 10));

  for (const g of dupeGroups) {
    // Find rows in group, ordered oldest-first
    const rows = await sql`
      SELECT id, "createdAt" FROM "InboxItem"
      WHERE status='PENDING' AND type=${g.type} AND "entityId"=${g.entityId}
      ORDER BY "createdAt" ASC, id ASC
    `;
    if (rows.length < 2) continue;
    const survivor = rows[0];
    const extras = rows.slice(1);
    survivors += 1;
    resolvedExtras += extras.length;
    if (!COMMIT) continue;

    // Roll the count onto survivor's actionData.mergedFromCount
    await sql`
      UPDATE "InboxItem"
      SET "actionData" = COALESCE("actionData", '{}'::jsonb) ||
            jsonb_build_object('mergedFromCount', ${extras.length}::int, 'mergedAt', now()::text),
          "updatedAt" = now()
      WHERE id = ${survivor.id}
    `;
    // Resolve extras
    for (const e of extras) {
      await sql`
        UPDATE "InboxItem"
        SET status='RESOLVED',
            "resolvedAt"=now(),
            "resolvedBy"=${CLEANUP_MARKER},
            result=${resultJson('merged-dupe', { survivorId: survivor.id })}::jsonb,
            "updatedAt"=now()
        WHERE id=${e.id}
      `;
    }
  }
  console.log(`[${mode()}] dupe survivors updated: ${survivors}, extras resolved: ${resolvedExtras}`);
  return { groups: dupeGroups.length, survivors, resolvedExtras };
}

// ─── Op 2: HW PPTX rollup ───────────────────────────────────────────────────
async function op2_hwPptxRollup() {
  bar('Op 2 — Collapse HW PPTX slide-level rows (31) → 1 rollup');
  const rows = await sql`
    SELECT id, "createdAt" FROM "InboxItem"
    WHERE status='PENDING'
      AND type='AGENT_TASK'
      AND "entityType"='BankPitch'
      AND "entityId"='HW_PITCH_PPTX_APR2026'
    ORDER BY "createdAt" ASC, id ASC
  `;
  console.log(`rows found: ${rows.length}`);
  if (rows.length === 0) return { kept: 0, resolved: 0 };
  const survivor = rows[0];
  const extras = rows.slice(1);
  if (COMMIT) {
    await sql`
      UPDATE "InboxItem"
      SET title = ${`HW PPTX Pitch — consolidated (${rows.length} slides)`},
          "actionData" = COALESCE("actionData", '{}'::jsonb) ||
            jsonb_build_object('rollupSlideCount', ${rows.length}::int, 'rollupAt', now()::text),
          "updatedAt" = now()
      WHERE id = ${survivor.id}
    `;
    for (const e of extras) {
      await sql`
        UPDATE "InboxItem"
        SET status='RESOLVED',
            "resolvedAt"=now(),
            "resolvedBy"=${CLEANUP_MARKER},
            result=${resultJson('merged-dupe', { survivorId: survivor.id, reason: 'hw-pptx-rollup' })}::jsonb,
            "updatedAt"=now()
        WHERE id=${e.id}
      `;
    }
  }
  console.log(`[${mode()}] kept 1 rollup, resolved ${extras.length}`);
  return { kept: 1, resolved: extras.length };
}

// ─── Op 3: drop [PIPELINE] empty-deal rows ─────────────────────────────────
async function op3_pipelineRows() {
  bar('Op 3 — Drop empty [PIPELINE] deal rows (no entityId)');
  const rows = await sql`
    SELECT id, title, "financialImpact" FROM "InboxItem"
    WHERE status='PENDING'
      AND type='ACTION_REQUIRED'
      AND title LIKE '[PIPELINE]%'
      AND "entityId" IS NULL
  `;
  console.log(`rows found: ${rows.length}`);
  console.log('sample:', rows.slice(0, 5));
  if (rows.length === 0 || !COMMIT) return { resolved: rows.length };
  // One batched UPDATE keyed by IN (…) is fine at this row count.
  await sql`
    UPDATE "InboxItem"
    SET status='RESOLVED',
        "resolvedAt"=now(),
        "resolvedBy"=${CLEANUP_MARKER},
        result=${resultJson('routed-to-deal-table', { reason: 'pipeline-empty-deal' })}::jsonb,
        "updatedAt"=now()
    WHERE status='PENDING'
      AND type='ACTION_REQUIRED'
      AND title LIKE '[PIPELINE]%'
      AND "entityId" IS NULL
  `;
  console.log(`[${mode()}] resolved ${rows.length}`);
  return { resolved: rows.length };
}

// ─── Op 4: SYSTEM_AUDIT_FINDING → historical ────────────────────────────────
async function op4_auditFindings() {
  bar('Op 4 — Auto-resolve SYSTEM_AUDIT_FINDING');
  const n = (await sql`
    SELECT COUNT(*)::int AS c FROM "InboxItem"
    WHERE status='PENDING' AND type='SYSTEM_AUDIT_FINDING'
  `)[0].c;
  console.log(`rows found: ${n}`);
  if (!COMMIT || n === 0) return { resolved: n };
  await sql`
    UPDATE "InboxItem"
    SET status='RESOLVED',
        "resolvedAt"=now(),
        "resolvedBy"=${CLEANUP_MARKER},
        result=${resultJson('auto-historical', { reason: 'brain-acked audit finding, belongs in audit log' })}::jsonb,
        "updatedAt"=now()
    WHERE status='PENDING' AND type='SYSTEM_AUDIT_FINDING'
  `;
  console.log(`[${mode()}] resolved ${n}`);
  return { resolved: n };
}

// ─── Op 5: IMPROVEMENT_* → strategic-plan-moved ─────────────────────────────
async function op5_improvement() {
  bar('Op 5 — Auto-resolve IMPROVEMENT_* (future RoadmapItem model)');
  const n = (await sql`
    SELECT COUNT(*)::int AS c FROM "InboxItem"
    WHERE status='PENDING' AND type LIKE 'IMPROVEMENT%'
  `)[0].c;
  console.log(`rows found: ${n}`);
  if (!COMMIT || n === 0) return { resolved: n };
  await sql`
    UPDATE "InboxItem"
    SET status='RESOLVED',
        "resolvedAt"=now(),
        "resolvedBy"=${CLEANUP_MARKER},
        result=${resultJson('strategic-plan-moved', { reason: 'move to RoadmapItem model when built' })}::jsonb,
        "updatedAt"=now()
    WHERE status='PENDING' AND type LIKE 'IMPROVEMENT%'
  `;
  console.log(`[${mode()}] resolved ${n}`);
  return { resolved: n };
}

// ─── Op 6: Pulte below-cost pricing ─────────────────────────────────────────
async function op6_pulteBelowCost() {
  bar('Op 6 — Auto-resolve Pulte below-cost pricing alerts');
  // Matches either the title string "Pulte" or actionData.builderName ILIKE %Pulte%
  const rows = await sql`
    SELECT id, title, "actionData"->>'builderName' AS builder
    FROM "InboxItem"
    WHERE status='PENDING'
      AND type='SYSTEM'
      AND title ILIKE '%Below-cost pricing%'
      AND (title ILIKE '%Pulte%' OR ("actionData"->>'builderName') ILIKE '%Pulte%')
  `;
  console.log(`rows found: ${rows.length}`);
  console.log('sample:', rows);
  if (!COMMIT || rows.length === 0) return { resolved: rows.length };
  await sql`
    UPDATE "InboxItem"
    SET status='RESOLVED',
        "resolvedAt"=now(),
        "resolvedBy"=${CLEANUP_MARKER},
        result=${resultJson('customer-lost', { note: 'Customer LOST 2026-04-20, no action needed.', customer: 'Pulte' })}::jsonb,
        "updatedAt"=now()
    WHERE status='PENDING'
      AND type='SYSTEM'
      AND title ILIKE '%Below-cost pricing%'
      AND (title ILIKE '%Pulte%' OR ("actionData"->>'builderName') ILIKE '%Pulte%')
  `;
  console.log(`[${mode()}] resolved ${rows.length}`);
  return { resolved: rows.length };
}

// ─── Op 7: assignedTo routing ───────────────────────────────────────────────
async function op7_routing() {
  bar('Op 7 — Route still-PENDING items to owners');

  // Clint: PO_APPROVAL, MRP_SHORTAGE, SYSTEM(BuilderPricing)
  const clintPreview = await sql`
    SELECT type, COUNT(*)::int AS c FROM "InboxItem"
    WHERE status='PENDING' AND "assignedTo" IS NULL AND (
      type IN ('PO_APPROVAL','MRP_SHORTAGE')
      OR (type='SYSTEM' AND "entityType"='BuilderPricing')
    )
    GROUP BY type
  `;
  console.log('→ Clint candidates:', clintPreview);

  // Dalton: DEAL_FOLLOWUP
  const daltonPreview = await sql`
    SELECT COUNT(*)::int AS c FROM "InboxItem"
    WHERE status='PENDING' AND "assignedTo" IS NULL AND type='DEAL_FOLLOWUP'
  `;
  console.log('→ Dalton candidates:', daltonPreview);

  // Nate: HYPHEN_DOC_UNMATCHED, DATA_QUALITY
  const natePreview = await sql`
    SELECT type, COUNT(*)::int AS c FROM "InboxItem"
    WHERE status='PENDING' AND "assignedTo" IS NULL
      AND type IN ('HYPHEN_DOC_UNMATCHED','DATA_QUALITY')
    GROUP BY type
  `;
  console.log('→ Nate candidates:', natePreview);

  // MATERIAL_CONFIRM_REQUIRED is left alone per brief (already has assignedTo from T-7 cron).
  // All others stay NULL (Nate triage).
  if (!COMMIT) return { clintPreview, daltonPreview, natePreview };

  const clintUpd = await sql`
    UPDATE "InboxItem"
    SET "assignedTo"=${CLINT}, "updatedAt"=now()
    WHERE status='PENDING' AND "assignedTo" IS NULL AND (
      type IN ('PO_APPROVAL','MRP_SHORTAGE')
      OR (type='SYSTEM' AND "entityType"='BuilderPricing')
    )
    RETURNING id
  `;
  const daltonUpd = await sql`
    UPDATE "InboxItem"
    SET "assignedTo"=${DALTON}, "updatedAt"=now()
    WHERE status='PENDING' AND "assignedTo" IS NULL AND type='DEAL_FOLLOWUP'
    RETURNING id
  `;
  const nateUpd = await sql`
    UPDATE "InboxItem"
    SET "assignedTo"=${NATE}, "updatedAt"=now()
    WHERE status='PENDING' AND "assignedTo" IS NULL
      AND type IN ('HYPHEN_DOC_UNMATCHED','DATA_QUALITY')
    RETURNING id
  `;
  console.log(`[COMMIT] assigned → Clint: ${clintUpd.length}, Dalton: ${daltonUpd.length}, Nate: ${nateUpd.length}`);
  return {
    clint: clintUpd.length, dalton: daltonUpd.length, nate: nateUpd.length,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n┌──────────────────────────────────────────────────────────────────┐`);
  console.log(`│  InboxItem cleanup — mode: ${mode().padEnd(37)}│`);
  console.log(`│  marker: ${CLEANUP_MARKER.padEnd(55)}│`);
  console.log(`└──────────────────────────────────────────────────────────────────┘`);

  const before = await snapshot('BEFORE');

  const r1 = await op1_mergeDupes();
  const r2 = await op2_hwPptxRollup();
  const r3 = await op3_pipelineRows();
  const r4 = await op4_auditFindings();
  const r5 = await op5_improvement();
  const r6 = await op6_pulteBelowCost();
  const r7 = await op7_routing();

  const after = await snapshot('AFTER');

  bar('Summary');
  console.log('mode:', mode());
  console.log('per-op:', { op1: r1, op2: r2, op3: r3, op4: r4, op5: r5, op6: r6, op7: r7 });
  const reduction = before.total - after.total;
  console.log(`total PENDING: ${before.total} → ${after.total}  (−${reduction}, ${before.total ? ((reduction/before.total)*100).toFixed(1) : 0}%)`);
  console.log(`assignedTo coverage: ${before.assign.assigned}/${before.assign.total} → ${after.assign.assigned}/${after.assign.total}` +
    (after.assign.total ? `  (${((after.assign.assigned/after.assign.total)*100).toFixed(1)}%)` : ''));
  if (!COMMIT) console.log('\n(DRY-RUN — re-run with --commit to apply.)');
}

main().catch(e => { console.error(e); process.exit(1); });
