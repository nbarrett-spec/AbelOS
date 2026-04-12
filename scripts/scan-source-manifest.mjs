// Walk the Abel Lumber folder and write a manifest.json listing every file,
// size, mtime, and top-level category. Used for Phase-2 brain audit so we
// can see what's ingested vs. still sitting on disk.
//
// Output: /Abel Lumber/abel-builder-platform/scripts/manifest.json
// Usage:  node scripts/scan-source-manifest.mjs
import fs from 'fs';
import path from 'path';
import { ABEL_FOLDER, SCRIPTS_DIR, bar } from './_brain-xlsx.mjs';

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', '.turbo', '.vscode', 'dist', 'build',
  '.claude', '.cache', 'tmp',
]);

const CAT_RULES = [
  [/\.(xlsx|xls|xlsm)$/i, 'excel'],
  [/\.csv$/i,             'csv'],
  [/\.json$/i,            'json'],
  [/\.pdf$/i,             'pdf'],
  [/\.(docx|doc)$/i,      'word'],
  [/\.(pptx|ppt)$/i,      'ppt'],
  [/\.md$/i,              'markdown'],
  [/\.(ts|tsx|js|mjs|cjs|jsx)$/i, 'code'],
  [/\.(png|jpg|jpeg|gif|svg|webp)$/i, 'image'],
  [/\.zip$/i,             'archive'],
  [/\.txt$/i,             'text'],
];

function categorize(name) {
  for (const [re, cat] of CAT_RULES) if (re.test(name)) return cat;
  return 'other';
}

function walk(root, maxDepth = 6) {
  const out = [];
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.claude') continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (e.isDirectory()) {
        if (depth < maxDepth) stack.push([p, depth + 1]);
        continue;
      }
      out.push({
        path: path.relative(root, p).replace(/\\/g, '/'),
        name: e.name,
        size: st.size,
        mtime: st.mtime.toISOString(),
        category: categorize(e.name),
      });
    }
  }
  return out;
}

function summarize(files) {
  const byCat = {};
  let totalBytes = 0;
  for (const f of files) {
    byCat[f.category] = (byCat[f.category] || 0) + 1;
    totalBytes += f.size;
  }
  const topDirs = {};
  for (const f of files) {
    const top = f.path.split('/')[0];
    topDirs[top] = (topDirs[top] || 0) + 1;
  }
  return { byCat, totalBytes, topDirs };
}

function main() {
  bar('SOURCE MANIFEST SCAN');
  console.log(`→ root: ${ABEL_FOLDER}`);
  const t0 = Date.now();
  const files = walk(ABEL_FOLDER);
  const summary = summarize(files);
  const out = {
    generatedAt: new Date().toISOString(),
    root: ABEL_FOLDER,
    fileCount: files.length,
    totalBytes: summary.totalBytes,
    byCategory: summary.byCat,
    topLevelDirs: summary.topDirs,
    files,
  };
  const outPath = path.join(SCRIPTS_DIR, 'manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ MANIFEST WRITTEN`);
  console.log(`   Files:      ${files.length}`);
  console.log(`   Total size: ${(summary.totalBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`   Categories: ${Object.entries(summary.byCat).map(([k,v])=>`${k}:${v}`).join(', ')}`);
  console.log(`   Output:     ${outPath}`);
  console.log(`   Elapsed:    ${((Date.now() - t0)/1000).toFixed(1)}s`);
}

main();
