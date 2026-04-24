// ─────────────────────────────────────────────────────────────────────────────
// verify-hyphen-pipeline.mjs
// ─────────────────────────────────────────────────────────────────────────────
// End-to-end test of the NUC → Aegis Hyphen ingest chain.
//
// What it does:
//   1. Posts THREE synthetic Hyphen events to POST /api/ops/hyphen/ingest:
//        a) plan_document        — Brookfield, subdivision "The Grove Frisco 55s"
//        b) change_order_detail  — Brookfield, same community, diff address
//        c) job_schedule_detail  — unknown builder/address (should UNMATCH)
//   2. For each event, verifies:
//        - HTTP 200 accepted (or 401 if AEGIS_API_KEY mismatches)
//        - HyphenDocument row exists with correct sourceId + fields
//        - matchConfidence is HIGH | MEDIUM | LOW | UNMATCHED
//        - HyphenCommunityAlias bridged the subdivision → Community when
//          appropriate (via correlation.builderId)
//        - InboxItem was created iff matchConfidence !== 'HIGH'
//   3. Cleans up all test rows (HyphenDocument + linked InboxItem).
//
// Environment:
//   HYPHEN_INGEST_URL   (optional, default http://localhost:3000)
//                       Full base URL; /api/ops/hyphen/ingest is appended.
//                       Examples:
//                         http://localhost:3000
//                         https://app.abellumber.com
//                         https://abel-builder-platform.vercel.app
//   AEGIS_API_KEY       REQUIRED. Bearer token matching what the NUC will send.
//                       Already present in .env for local/prod use.
//   DATABASE_URL        REQUIRED. Used to spot-check that the route actually
//                       wrote what it claimed.
//
// Usage:
//   node scripts/verify-hyphen-pipeline.mjs
//   HYPHEN_INGEST_URL=https://app.abellumber.com node scripts/verify-hyphen-pipeline.mjs
//   node scripts/verify-hyphen-pipeline.mjs --keep        # skip cleanup
//   node scripts/verify-hyphen-pipeline.mjs --in-process  # skip HTTP, exercise
//                                                          # the correlator + DB
//                                                          # writes directly.
//                                                          # Useful when the
//                                                          # dev server is down
//                                                          # or outbound HTTP
//                                                          # is sandboxed.
//
// Exit codes:
//   0 — all checks passed
//   1 — at least one check failed (details printed)
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();
const BASE_URL = (process.env.HYPHEN_INGEST_URL || 'http://localhost:3000').replace(/\/+$/, '');
const ENDPOINT = `${BASE_URL}/api/ops/hyphen/ingest`;
const API_KEY = process.env.AEGIS_API_KEY;
const KEEP = process.argv.includes('--keep');
const IN_PROCESS = process.argv.includes('--in-process');
const TEST_PREFIX = `hyphen_verify_${Date.now()}_${randomBytes(3).toString('hex')}`;

function line(ch = '─') {
  console.log(ch.repeat(74));
}
function banner(t) {
  console.log('');
  line('═');
  console.log('  ' + t);
  line('═');
}
function pass(msg) {
  console.log(`  [PASS] ${msg}`);
}
function fail(msg) {
  console.log(`  [FAIL] ${msg}`);
}
function info(msg) {
  console.log(`  ${msg}`);
}

// ── Test fixtures ─────────────────────────────────────────────────────────
// Chosen to exercise three correlation paths:
//   - Event A: known Brookfield subdivision + lot → community-alias bridge,
//              expected MEDIUM (via lot match under the aliased community)
//              or LOW (via community fallback alone).
//   - Event B: same community, change_order event, with a realistic PO string
//              that likely won't match any Order → relies on alias bridge.
//   - Event C: unknown builder & garbage address → UNMATCHED, triggers
//              InboxItem.
const fixtures = [
  {
    label: 'A — plan_document (Brookfield, known subdivision)',
    payload: {
      source: 'hyphen-verify',
      source_id: `${TEST_PREFIX}_plan`,
      event_type: 'plan_document',
      title: 'Verify: plan_document',
      content: 'Synthetic test plan document',
      tags: ['verify', 'test'],
      metadata: {
        po_number: `VERIFY-${TEST_PREFIX}-PLAN`,
        builder_name: 'Brookfield Homes',
        subdivision: 'The Grove Frisco 55s',
        lot_block: 'Lot 14 Block 3',
        plan_elv_swing: 'Plan A / Elev 1 / L-Swing',
        job_address: '15367 Synthetic Verify Drive, Frisco, TX',
        group_name: 'Group 1',
        phase: 'Phase 1',
        doc_category: 'Plans',
        file: {
          file_name: 'synthetic-plan.pdf',
          file_url: 'https://example.invalid/plan.pdf',
          file_sha256: 'a'.repeat(64),
          file_size_bytes: 1024,
          content_type: 'application/pdf',
        },
        extraction_method: 'verify-script',
        scraped_at: new Date().toISOString(),
      },
    },
    expectHigh: false, // PO won't match an Order row, so address/alias paths run
    expectMatched: true, // should resolve to some Job via subdivision alias
  },
  {
    label: 'B — change_order_detail (Brookfield, alt subdivision)',
    payload: {
      source: 'hyphen-verify',
      source_id: `${TEST_PREFIX}_co`,
      event_type: 'change_order_detail',
      title: 'Verify: change_order_detail',
      metadata: {
        po_number: `VERIFY-${TEST_PREFIX}-CO`,
        builder_name: 'Brookfield Homes',
        subdivision: 'The Grove Frisco 40s',
        lot_block: 'Lot 22 Block 1',
        job_address: 'Synthetic Verify Lane',
        doc_category: 'Change Orders',
        change_order: {
          co_number: 'CO-VERIFY-001',
          original_po: `VERIFY-${TEST_PREFIX}-CO-ORIG`,
          reason: 'verify',
          net_value_change: 123.45,
          builder_status: 'Pending',
          has_pdf: false,
        },
        scraped_at: new Date().toISOString(),
      },
    },
    expectHigh: false,
    expectMatched: true,
  },
  {
    label: 'C — job_schedule_detail (unknown builder — must UNMATCH)',
    payload: {
      source: 'hyphen-verify',
      source_id: `${TEST_PREFIX}_sched`,
      event_type: 'job_schedule_detail',
      title: 'Verify: job_schedule_detail',
      metadata: {
        po_number: null,
        builder_name: 'Nonexistent Builder Co ZZZ',
        subdivision: 'Subdivision That Does Not Exist 99x',
        job_address: 'Nowhere Ln',
        doc_category: 'Schedules',
        schedule: {
          requested_start: new Date(Date.now() + 86400000).toISOString(),
          requested_end: new Date(Date.now() + 172800000).toISOString(),
          is_late: false,
        },
        scraped_at: new Date().toISOString(),
      },
    },
    expectHigh: false,
    expectMatched: false, // should UNMATCHED → InboxItem
  },
];

async function postIngest(payload) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = { _nonJson: true, text: await res.text().catch(() => '') };
  }
  return { status: res.status, body };
}

// ── In-process path: mirrors src/app/api/ops/hyphen/ingest/route.ts + ───────
//    src/lib/hyphen/correlate.ts. Used when --in-process is set.
const STOP_WORDS = new Set([
  'homes','home','dfw','inc','llc','co','corp','the','and','&','builders','builder',
  'custom','doors','door','trim','construction','group','company','development',
  'design','designs','homebuilders','properties','contractors','of','by','a','an',
]);
const norm = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const tokenize = (s) => norm(s).split(' ').filter((t) => t && !STOP_WORDS.has(t));
const compressed = (s) => tokenize(s).join('');

async function inProcessCorrelate({ poNumber, builderName, jobAddress, lotBlock, subdivision }) {
  // Builder match (compressed-string variant used by correlate.ts)
  let builderId = null;
  if (builderName) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id","companyName" FROM "Builder" WHERE "companyName" IS NOT NULL AND "companyName" <> ''`,
    );
    const src = compressed(builderName);
    if (src) {
      const exact = rows.find((r) => compressed(r.companyName) === src);
      if (exact) builderId = exact.id;
      if (!builderId) {
        const contained = rows
          .filter((r) => {
            const c = compressed(r.companyName);
            return c.length >= 3 && src.length >= 3 && (c.includes(src) || src.includes(c));
          })
          .sort((a, b) => compressed(b.companyName).length - compressed(a.companyName).length);
        if (contained.length) builderId = contained[0].id;
      }
    }
  }

  // HIGH: PO exact on Order+Job
  if (poNumber) {
    const hit = await prisma.$queryRawUnsafe(
      `SELECT j."id" AS "jobId" FROM "Order" o
         LEFT JOIN "Job" j ON j."orderId" = o."id"
        WHERE o."poNumber" = $1 AND j."id" IS NOT NULL LIMIT 1`,
      poNumber,
    );
    if (hit.length && hit[0].jobId) {
      return { jobId: hit[0].jobId, builderId, matchConfidence: 'HIGH', matchMethod: 'po_exact' };
    }
    const jobHit = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Job" WHERE "bwpPoNumber" = $1 OR "hyphenJobId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      poNumber,
    );
    if (jobHit.length) {
      return { jobId: jobHit[0].id, builderId, matchConfidence: 'HIGH', matchMethod: 'po_exact' };
    }
  }

  // Community alias resolution
  let alias = null;
  if (subdivision) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "aegisCommunityId","builderId","matchConfidence" FROM "HyphenCommunityAlias" WHERE "hyphenName" = $1 LIMIT 1`,
        subdivision,
      );
      if (rows.length && rows[0].aegisCommunityId) alias = rows[0];
    } catch {}
  }
  const resolvedBuilderId = builderId || alias?.builderId || null;

  // Address fuzzy match (simplified — prefix)
  const na = (jobAddress || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (na && na.length >= 5) {
    const cands = await prisma.$queryRawUnsafe(
      `SELECT "id","jobAddress","lotBlock","builderName" FROM "Job"
        WHERE "jobAddress" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 2000`,
    );
    const hits = [];
    for (const c of cands) {
      const ca = (c.jobAddress || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!ca) continue;
      let addrHit = ca === na || (ca.length >= 6 && na.length >= 6 && (ca.includes(na) || na.includes(ca)));
      if (!addrHit) continue;
      const lotHit = !!lotBlock && norm(c.lotBlock) === norm(lotBlock);
      const builderHit = !!builderName && compressed(c.builderName) === compressed(builderName);
      const score = 1 + (builderHit ? 2 : 0) + (lotHit ? 1 : 0);
      hits.push({ jobId: c.id, score, builderHit, lotHit });
    }
    hits.sort((a, b) => b.score - a.score);
    if (hits.length) {
      const top = hits[0];
      if (top.builderHit && top.lotHit)
        return { jobId: top.jobId, builderId: resolvedBuilderId, matchConfidence: 'MEDIUM', matchMethod: 'address_lot_builder' };
      if (top.builderHit)
        return { jobId: top.jobId, builderId: resolvedBuilderId, matchConfidence: 'MEDIUM', matchMethod: 'address_builder' };
      return { jobId: top.jobId, builderId: resolvedBuilderId, matchConfidence: 'LOW', matchMethod: 'address_only' };
    }
  }

  // Community-alias fallback (the new bridge)
  if (alias?.aegisCommunityId) {
    const commJobs = await prisma.$queryRawUnsafe(
      `SELECT "id","lotBlock" FROM "Job" WHERE "communityId" = $1 ORDER BY "createdAt" DESC LIMIT 500`,
      alias.aegisCommunityId,
    );
    if (commJobs.length) {
      const lotHit = lotBlock ? commJobs.find((j) => norm(j.lotBlock) === norm(lotBlock)) : null;
      if (lotHit) {
        return { jobId: lotHit.id, builderId: resolvedBuilderId, matchConfidence: 'MEDIUM', matchMethod: 'address_lot_builder' };
      }
      return { jobId: commJobs[0].id, builderId: resolvedBuilderId, matchConfidence: 'LOW', matchMethod: 'address_only' };
    }
  }

  return { jobId: null, builderId: resolvedBuilderId, matchConfidence: 'UNMATCHED', matchMethod: 'unmatched' };
}

// Simulates what POST /api/ops/hyphen/ingest does: correlate → upsert
// HyphenDocument → create InboxItem if non-HIGH. Returns the same shape the
// HTTP route returns.
async function inProcessIngest(payload) {
  const m = payload.metadata || {};
  const file = m.file || {};
  const schedule = m.schedule || {};
  const co = m.change_order || {};

  const correlation = await inProcessCorrelate({
    poNumber: m.po_number ?? null,
    builderName: m.builder_name ?? null,
    jobAddress: m.job_address ?? null,
    lotBlock: m.lot_block ?? null,
    subdivision: m.subdivision ?? null,
  });

  const scrapedAt = m.scraped_at ? new Date(m.scraped_at) : new Date();
  const doc = await prisma.hyphenDocument.upsert({
    where: { sourceId: payload.source_id },
    create: {
      sourceId: payload.source_id,
      eventType: payload.event_type,
      jobId: correlation.jobId,
      builderId: correlation.builderId,
      poNumber: m.po_number ?? null,
      builderName: m.builder_name ?? null,
      subdivision: m.subdivision ?? null,
      lotBlock: m.lot_block ?? null,
      planElvSwing: m.plan_elv_swing ?? null,
      jobAddress: m.job_address ?? null,
      groupName: m.group_name ?? null,
      phase: m.phase ?? null,
      docCategory: m.doc_category ?? null,
      fileName: file.file_name ?? null,
      fileUrl: file.file_url ?? null,
      fileSha256: file.file_sha256 ?? null,
      fileSizeBytes: file.file_size_bytes ?? null,
      contentType: file.content_type ?? null,
      coNumber: co.co_number ?? null,
      originalPo: co.original_po ?? null,
      coReason: co.reason ?? null,
      coNetValueChange: typeof co.net_value_change === 'number' ? co.net_value_change : null,
      coBuilderStatus: co.builder_status ?? null,
      matchConfidence: correlation.matchConfidence,
      matchMethod: correlation.matchMethod,
      rawPayload: payload,
      scrapedAt,
    },
    update: { updatedAt: new Date() },
  });

  if (correlation.matchConfidence !== 'HIGH') {
    const existing = await prisma.inboxItem.findFirst({
      where: { type: 'HYPHEN_DOC_UNMATCHED', entityType: 'HyphenDocument', entityId: doc.id },
      select: { id: true },
    });
    if (!existing) {
      await prisma.inboxItem.create({
        data: {
          type: 'HYPHEN_DOC_UNMATCHED',
          source: 'hyphen-ingest',
          title:
            correlation.matchConfidence === 'UNMATCHED'
              ? `Hyphen doc UNMATCHED: ${payload.source_id}`
              : `Hyphen doc ${correlation.matchConfidence} match — review: ${payload.source_id}`,
          description: `In-process verify fixture (builder=${m.builder_name || '-'}, sub=${m.subdivision || '-'}, method=${correlation.matchMethod})`,
          priority: correlation.matchConfidence === 'UNMATCHED' ? 'HIGH' : 'MEDIUM',
          status: 'PENDING',
          entityType: 'HyphenDocument',
          entityId: doc.id,
          actionData: {
            hyphenDocumentId: doc.id,
            suggestedJobId: correlation.jobId,
            matchConfidence: correlation.matchConfidence,
            matchMethod: correlation.matchMethod,
            builderId: correlation.builderId,
          },
        },
      });
    }
  }

  return {
    status: 200,
    body: {
      status: 'accepted',
      documentId: doc.id,
      jobId: correlation.jobId,
      builderId: correlation.builderId,
      matchConfidence: correlation.matchConfidence,
      matchMethod: correlation.matchMethod,
    },
  };
}

async function preflight() {
  banner('PREFLIGHT');
  info(`Mode: ${IN_PROCESS ? 'IN-PROCESS (bypassing HTTP)' : 'HTTP'}`);
  if (IN_PROCESS) {
    pass('in-process mode — no API key / endpoint check needed');
  } else {
    if (!API_KEY) {
      fail('AEGIS_API_KEY not set in env. Set it in .env or export it before running.');
      info(`   .env file: ${process.cwd()}/.env`);
      return false;
    }
    pass('AEGIS_API_KEY present');

    // Test that the endpoint is reachable.
    info(`Endpoint: ${ENDPOINT}`);
    try {
      const probe = await fetch(ENDPOINT, { method: 'POST' });
      // Any HTTP response (even 401/400) means the endpoint is alive.
      if (probe.status >= 200 && probe.status < 600) {
        pass(`Endpoint reachable (HTTP ${probe.status} on unauth probe)`);
      }
    } catch (e) {
      fail(`Endpoint unreachable: ${e.message}`);
      info(`   If testing against localhost, start the dev server first:`);
      info(`     npm run dev`);
      info(`   Or target a live deployment:`);
      info(`     HYPHEN_INGEST_URL=https://app.abellumber.com node scripts/verify-hyphen-pipeline.mjs`);
      info(`   Or bypass HTTP entirely:`);
      info(`     node scripts/verify-hyphen-pipeline.mjs --in-process`);
      return false;
    }
  }

  // Confirm HyphenCommunityAlias exists so event A/B can exercise the bridge.
  const aliasExists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'HyphenCommunityAlias'`,
  );
  if (aliasExists.length) {
    const aliasCnt = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "HyphenCommunityAlias"`,
    );
    pass(`HyphenCommunityAlias table present (${aliasCnt[0].n} rows)`);
  } else {
    info('HyphenCommunityAlias missing — run `node scripts/seed-hyphen-community-aliases.mjs --apply` first.');
  }
  return true;
}

async function runFixture(fx) {
  banner(`FIXTURE ${fx.label}`);
  let okLocal = true;

  // 1) POST
  const { status, body } = await postIngest(fx.payload);
  if (status === 401) {
    fail(`HTTP 401 — AEGIS_API_KEY on the server does not match the key in this script's env.`);
    return false;
  }
  if (status !== 200) {
    fail(`expected HTTP 200, got ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    return false;
  }
  pass(`HTTP 200`);
  info(`   response: documentId=${body.documentId} conf=${body.matchConfidence} method=${body.matchMethod} jobId=${body.jobId ?? 'null'} builderId=${body.builderId ?? 'null'}`);

  // 2) HyphenDocument row
  const [doc] = await prisma.$queryRawUnsafe(
    `SELECT "id","sourceId","eventType","jobId","builderId","matchConfidence","matchMethod","subdivision","builderName"
       FROM "HyphenDocument"
      WHERE "sourceId" = $1
      LIMIT 1`,
    fx.payload.source_id,
  );
  if (!doc) {
    fail(`HyphenDocument row missing for sourceId=${fx.payload.source_id}`);
    return false;
  }
  pass(`HyphenDocument persisted (${doc.id})`);
  if (doc.eventType !== fx.payload.event_type) {
    fail(`eventType mismatch: got ${doc.eventType}, expected ${fx.payload.event_type}`);
    okLocal = false;
  }
  if (doc.subdivision !== (fx.payload.metadata.subdivision || null)) {
    fail(`subdivision mismatch: got ${doc.subdivision}, expected ${fx.payload.metadata.subdivision}`);
    okLocal = false;
  }
  if (doc.builderName !== (fx.payload.metadata.builder_name || null)) {
    fail(`builderName mismatch: got ${doc.builderName}`);
    okLocal = false;
  }

  // 3) Correlation expectations
  const allowed = ['HIGH', 'MEDIUM', 'LOW', 'UNMATCHED'];
  if (!allowed.includes(doc.matchConfidence)) {
    fail(`invalid matchConfidence: ${doc.matchConfidence}`);
    okLocal = false;
  } else {
    pass(`matchConfidence = ${doc.matchConfidence} (${doc.matchMethod})`);
  }
  if (fx.expectMatched && doc.matchConfidence === 'UNMATCHED') {
    fail(`fixture expected a match, got UNMATCHED`);
    okLocal = false;
  }
  if (!fx.expectMatched && doc.matchConfidence !== 'UNMATCHED') {
    fail(`fixture expected UNMATCHED, got ${doc.matchConfidence}`);
    okLocal = false;
  }

  // 4) Alias bridge check (only for fixtures that have a subdivision)
  if (fx.payload.metadata.subdivision) {
    const [alias] = await prisma.$queryRawUnsafe(
      `SELECT "aegisCommunityId","builderId","matchConfidence","source"
         FROM "HyphenCommunityAlias"
        WHERE "hyphenName" = $1
        LIMIT 1`,
      fx.payload.metadata.subdivision,
    );
    if (alias && alias.aegisCommunityId) {
      pass(`alias bridge: "${fx.payload.metadata.subdivision}" → community ${alias.aegisCommunityId.slice(0, 10)}... (${alias.matchConfidence}/${alias.source})`);
      if (doc.builderId && alias.builderId && doc.builderId !== alias.builderId) {
        info(`   note: doc.builderId (${doc.builderId.slice(0, 10)}...) differs from alias.builderId (${alias.builderId.slice(0, 10)}...) — ok, alias is hint only`);
      }
    } else {
      info(`   no HyphenCommunityAlias row for "${fx.payload.metadata.subdivision}" (expected for fixture C)`);
    }
  }

  // 5) InboxItem expectations
  const inbox = await prisma.$queryRawUnsafe(
    `SELECT "id","type","priority","status" FROM "InboxItem"
      WHERE "entityType" = 'HyphenDocument' AND "entityId" = $1`,
    doc.id,
  );
  if (doc.matchConfidence === 'HIGH') {
    if (inbox.length) {
      fail(`HIGH match unexpectedly produced an InboxItem`);
      okLocal = false;
    } else {
      pass(`no InboxItem (expected, HIGH match)`);
    }
  } else {
    if (!inbox.length) {
      fail(`non-HIGH match (${doc.matchConfidence}) did NOT produce an InboxItem`);
      okLocal = false;
    } else {
      pass(`InboxItem created (priority=${inbox[0].priority}, status=${inbox[0].status})`);
    }
  }

  return okLocal;
}

async function cleanup() {
  if (KEEP) {
    banner('CLEANUP SKIPPED (--keep)');
    info(`Test sourceId prefix: ${TEST_PREFIX}`);
    return;
  }
  banner('CLEANUP');
  const deletedInbox = await prisma.$executeRawUnsafe(
    `DELETE FROM "InboxItem"
      WHERE "entityType" = 'HyphenDocument'
        AND "entityId" IN (SELECT "id" FROM "HyphenDocument" WHERE "sourceId" LIKE $1)`,
    `${TEST_PREFIX}_%`,
  );
  const deletedDocs = await prisma.$executeRawUnsafe(
    `DELETE FROM "HyphenDocument" WHERE "sourceId" LIKE $1`,
    `${TEST_PREFIX}_%`,
  );
  info(`Deleted ${deletedInbox} InboxItems + ${deletedDocs} HyphenDocuments.`);
}

async function main() {
  banner('HYPHEN PIPELINE VERIFY');
  info(`Endpoint:     ${ENDPOINT}`);
  info(`Test prefix:  ${TEST_PREFIX}`);

  if (!(await preflight())) {
    process.exit(1);
  }

  let ok = true;
  for (const fx of fixtures) {
    const r = await runFixture(fx);
    if (!r) ok = false;
  }

  await cleanup();

  banner(ok ? 'RESULT: ALL CHECKS PASSED' : 'RESULT: FAILURES DETECTED');
  process.exit(ok ? 0 : 1);
}

main()
  .catch(async (e) => {
    console.error('FATAL:', e);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  })
  .finally(() => prisma.$disconnect().catch(() => {}));
