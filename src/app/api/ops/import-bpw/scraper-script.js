// ──────────────────────────────────────────────────────────────────────
// BPW → Abel OS Scraper Script
// ──────────────────────────────────────────────────────────────────────
// Run this from the Abel OS browser console (app.abellumber.com)
// after scraping data on BPW pages.
//
// Usage:
//   1. Copy the scraped data arrays into this script
//   2. Run in the Abel OS console
//   3. Data is posted to /api/ops/import-bpw/intake in chunks
//   4. Then call /api/ops/import-bpw/process to finalize
// ──────────────────────────────────────────────────────────────────────

async function postChunkedData(dataType, data, chunkSize = 100) {
  const totalChunks = Math.ceil(data.length / chunkSize);
  console.log(`Posting ${data.length} ${dataType} in ${totalChunks} chunks...`);

  let successCount = 0;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    const chunkNum = Math.floor(i / chunkSize);

    try {
      const res = await fetch('/api/ops/import-bpw/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataType,
          chunk: chunkNum,
          totalChunks,
          data: chunk,
        }),
      });

      const result = await res.json();
      if (result.success) {
        successCount++;
        console.log(`  Chunk ${chunkNum + 1}/${totalChunks}: ${chunk.length} records ✓`);
      } else {
        console.error(`  Chunk ${chunkNum + 1} failed:`, result.error);
      }
    } catch (err) {
      console.error(`  Chunk ${chunkNum + 1} error:`, err.message);
    }
  }

  console.log(`${dataType}: ${successCount}/${totalChunks} chunks posted successfully`);
  return successCount === totalChunks;
}

async function processAllData(dataTypes) {
  console.log('Processing staged data...');
  const res = await fetch('/api/ops/import-bpw/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataTypes }),
  });
  const result = await res.json();
  console.log('Process result:', JSON.stringify(result, null, 2));
  return result;
}

async function checkStatus() {
  const res = await fetch('/api/ops/import-bpw/intake');
  const result = await res.json();
  console.log('Staging status:', JSON.stringify(result, null, 2));
  return result;
}

// Export for use
window.bpwImport = { postChunkedData, processAllData, checkStatus };
console.log('BPW Import helpers loaded. Use window.bpwImport.postChunkedData(), processAllData(), checkStatus()');
