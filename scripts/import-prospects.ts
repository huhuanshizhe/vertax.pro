/**
 * 从 XLSX/CSV 文件批量导入 ProspectCompany
 *
 * 用法:
 *   npx tsx scripts/import-prospects.ts <file> [options]
 *
 * 参数:
 *   <file>            XLSX 或 CSV 文件路径
 *   --tenant <slug>   租户 slug (必填)
 *   --mapping <json>  列映射 JSON 文件路径 (必填)
 *   --depth <level>   enrichment 深度: BASIC | DEEP (默认: BASIC)
 *   --no-enrich       跳过 enrich 阶段 (仅导入)
 *   --dry-run         仅解析和预览，不写入数据库
 *
 * 列映射示例 (mapping.json):
 *   {
 *     "Company Name": "displayName",
 *     "Country": "country",
 *     "Website": "website",
 *     "Industry": "industry"
 *   }
 */

import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/lib/prisma';
import {
  parseFileBuffer,
  createBatchWithItems,
  processImportChunk,
  processEnrichChunk,
} from '../src/lib/radar/batch-import-engine';
import type { ColumnMapping, EnrichmentDepth, ImportFileFormat } from '../src/lib/radar/batch-import-types';

// ==================== CLI Arg Parsing ====================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    filePath: '',
    tenantSlug: '',
    mappingPath: '',
    depth: 'BASIC' as EnrichmentDepth,
    noEnrich: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tenant' && args[i + 1]) {
      config.tenantSlug = args[++i];
    } else if (arg === '--mapping' && args[i + 1]) {
      config.mappingPath = args[++i];
    } else if (arg === '--depth' && args[i + 1]) {
      config.depth = args[++i] as EnrichmentDepth;
    } else if (arg === '--no-enrich') {
      config.noEnrich = true;
    } else if (arg === '--dry-run') {
      config.dryRun = true;
    } else if (!arg.startsWith('--') && !config.filePath) {
      config.filePath = arg;
    }
  }

  return config;
}

function detectFileFormat(filePath: string): ImportFileFormat {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') return 'XLSX';
  if (ext === '.csv' || ext === '.tsv') return 'CSV';
  throw new Error(`Unsupported file format: ${ext}. Use .xlsx or .csv`);
}

// ==================== Main ====================

async function main() {
  const config = parseArgs();

  // Validate args
  if (!config.filePath) {
    console.error('Error: file path is required');
    console.error('Usage: npx tsx scripts/import-prospects.ts <file> --tenant <slug> --mapping <json>');
    process.exit(1);
  }

  if (!config.tenantSlug) {
    console.error('Error: --tenant <slug> is required');
    process.exit(1);
  }

  if (!config.mappingPath) {
    console.error('Error: --mapping <json> is required');
    process.exit(1);
  }

  // Load file
  if (!fs.existsSync(config.filePath)) {
    console.error(`Error: file not found: ${config.filePath}`);
    process.exit(1);
  }

  // Load mapping
  if (!fs.existsSync(config.mappingPath)) {
    console.error(`Error: mapping file not found: ${config.mappingPath}`);
    process.exit(1);
  }

  const columnMapping: ColumnMapping = JSON.parse(
    fs.readFileSync(config.mappingPath, 'utf-8')
  );

  // Find tenant
  const tenant = await prisma.tenant.findFirst({
    where: { slug: config.tenantSlug },
    select: { id: true, name: true },
  });

  if (!tenant) {
    console.error(`Error: tenant not found with slug: ${config.tenantSlug}`);
    process.exit(1);
  }

  // Find owner user
  const user = await prisma.user.findFirst({
    where: { tenantId: tenant.id },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!user) {
    console.error(`Error: no user found for tenant: ${config.tenantSlug}`);
    process.exit(1);
  }

  console.log(`\n=== Prospect Import ===`);
  console.log(`Tenant:  ${tenant.name} (${config.tenantSlug})`);
  console.log(`File:    ${config.filePath}`);
  console.log(`Depth:   ${config.depth}`);
  console.log(`Enrich:  ${config.noEnrich ? 'SKIP' : 'YES'}`);
  console.log(`Dry Run: ${config.dryRun ? 'YES' : 'NO'}`);
  console.log('');

  // Parse file
  const fileFormat = detectFileFormat(config.filePath);
  const buffer = fs.readFileSync(config.filePath);
  const rows = parseFileBuffer(buffer, fileFormat, columnMapping);

  console.log(`Parsed ${rows.length} rows from ${fileFormat} file`);
  console.log(`Column mapping: ${Object.keys(columnMapping).length} columns mapped`);

  // Preview first 3 rows
  console.log('\n--- Preview (first 3 rows) ---');
  for (const row of rows.slice(0, 3)) {
    console.log(`  Row ${row.rowIndex}: ${row.normalized.displayName} | ${row.normalized.country || '-'} | ${row.normalized.website || '-'}`);
  }
  console.log('');

  if (config.dryRun) {
    console.log('[DRY RUN] No data written. Exiting.');
    process.exit(0);
  }

  // Create batch
  console.log('Creating import batch...');
  const batchId = await createBatchWithItems({
    tenantId: tenant.id,
    userId: user.id,
    fileFormat,
    columnMapping,
    enrichmentDepth: config.depth,
    skipDuplicates: true,
  }, rows);

  console.log(`Batch created: ${batchId}`);

  // Process import
  console.log('\n--- Import Phase ---');
  let totalImported = 0;
  let totalDuplicates = 0;
  let totalFailed = 0;

  while (true) {
    const result = await processImportChunk(batchId, {
      concurrency: 10,
      chunkSize: 50,
      skipDuplicates: true,
    });

    if (result.processed === 0) break;

    totalImported += result.imported;
    totalDuplicates += result.duplicates;
    totalFailed += result.failed;

    console.log(`  Chunk: +${result.imported} imported, ${result.duplicates} dupes, ${result.failed} failed`);

    if (result.errors.length > 0) {
      for (const err of result.errors.slice(0, 3)) {
        console.log(`    Error: ${err}`);
      }
    }
  }

  console.log(`\nImport complete: ${totalImported} imported, ${totalDuplicates} duplicates, ${totalFailed} failed`);

  // Update batch status
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: config.noEnrich ? 'COMPLETED' : 'ENRICHING' },
  });

  // Process enrich (if enabled)
  if (!config.noEnrich) {
    console.log('\n--- Enrich Phase ---');
    let totalEnriched = 0;
    let enrichFailed = 0;

    while (true) {
      const result = await processEnrichChunk(batchId, {
        concurrency: 3,
        chunkSize: 15,
        timeoutMs: 15_000,
      });

      if (result.processed === 0) break;

      totalEnriched += result.enriched;
      enrichFailed += result.failed;

      console.log(`  Chunk: +${result.enriched} enriched, ${result.failed} failed`);

      if (result.errors.length > 0) {
        for (const err of result.errors.slice(0, 3)) {
          console.log(`    Error: ${err}`);
        }
      }
    }

    console.log(`\nEnrich complete: ${totalEnriched} enriched, ${enrichFailed} failed`);

    // Mark batch as completed
    await prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'COMPLETED' },
    });
  }

  console.log('\n=== Done ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
