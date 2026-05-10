/**
 * Batch Import Engine
 *
 * 核心职责：
 * 1. parseFile() - 解析 XLSX/CSV/Paste 为标准行
 * 2. createBatchWithItems() - 创建 ImportBatch + ImportBatchItem
 * 3. processImportChunk() - 导入阶段：dedup → 创建 ProspectCompany
 * 4. processEnrichChunk() - 富化阶段：调用 enrichProspectCompanyV2
 * 5. processCronTick() - 一次 cron 调用的完整流程
 */

import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';
import { parse as csvParse } from 'csv-parse/sync';
import { normalizeCompanyDomain } from './intelligence-enricher';
import { enrichProspectCompanyV2 } from './prospect-company-enrichment';
import type {
  BatchImportConfig,
  ColumnMapping,
  CronProcessConfig,
  CronTickResult,
  DedupeMatchType,
  DedupeResult,
  NormalizedCompanyData,
  ParsedRow,
  ProspectField,
} from './batch-import-types';
import { DEFAULT_CRON_CONFIG } from './batch-import-types';

// ==================== 1. File Parsing ====================

/**
 * 从 Buffer 解析出原始行数据
 */
export function parseFileBuffer(
  buffer: Buffer,
  format: 'XLSX' | 'CSV' | 'PASTE',
  columnMapping: ColumnMapping
): ParsedRow[] {
  let rawRows: Record<string, string>[];

  if (format === 'XLSX') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: '',
      raw: false,
    });
  } else {
    // CSV or PASTE (both are text-based)
    const text = buffer.toString('utf-8');
    rawRows = csvParse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as Record<string, string>[];
  }

  return rawRows.map((raw, index) => ({
    rowIndex: index,
    raw,
    normalized: normalizeRow(raw, columnMapping),
  }));
}

function normalizeRow(
  raw: Record<string, string>,
  mapping: ColumnMapping
): NormalizedCompanyData {
  const result: Record<string, unknown> = {};

  for (const [sourceCol, targetField] of Object.entries(mapping)) {
    const value = raw[sourceCol]?.trim() || null;
    if (!value) continue;

    if (targetField === 'tags') {
      result.tags = value.split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
    } else {
      result[targetField] = value;
    }
  }

  // displayName 是必填，如果缺失则取第一个有值的字段
  if (!result.displayName) {
    const firstValue = Object.values(raw).find((v) => v?.trim());
    result.displayName = firstValue?.trim() || 'Unknown';
  }

  return result as unknown as NormalizedCompanyData;
}

// ==================== 2. Create Batch ====================

/**
 * 创建 ImportBatch 及其所有 Items (PARSING → PREVIEWING)
 */
export async function createBatchWithItems(
  config: BatchImportConfig,
  rows: ParsedRow[]
): Promise<string> {
  const batch = await prisma.importBatch.create({
    data: {
      tenantId: config.tenantId,
      createdById: config.userId,
      fileName: 'import',
      fileFormat: config.fileFormat,
      totalRows: rows.length,
      columnMapping: config.columnMapping as object,
      enrichmentDepth: config.enrichmentDepth,
      sourceAssetId: config.sourceAssetId,
      status: 'PARSING',
    },
  });

  // 批量创建 items (分批 500 条)
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await prisma.importBatchItem.createMany({
      data: chunk.map((row) => ({
        batchId: batch.id,
        rowIndex: row.rowIndex,
        rawData: row.raw as object,
        normalizedData: row.normalized as object,
        status: 'PENDING' as const,
      })),
    });
  }

  // 更新状态为 IMPORTING
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { status: 'IMPORTING' },
  });

  return batch.id;
}

// ==================== 3. Dedup Logic ====================

/**
 * 检查一行数据是否与现有 ProspectCompany 重复
 * 优先级: domain match > name+country match
 */
export async function checkDuplicate(
  tenantId: string,
  data: NormalizedCompanyData
): Promise<DedupeResult> {
  // 1. Domain match
  if (data.website) {
    const domain = normalizeCompanyDomain(data.website);
    if (domain) {
      const existing = await prisma.prospectCompany.findFirst({
        where: { tenantId, website: { contains: domain, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        return { matchType: 'domain', matchId: existing.id, shouldSkip: true };
      }
    }
  }

  // 2. Name + Country match
  const normalizedName = normalizeCompanyName(data.displayName);
  if (normalizedName.length >= 3) {
    const candidates = await prisma.prospectCompany.findMany({
      where: {
        tenantId,
        country: data.country || undefined,
      },
      select: { id: true, name: true },
    });

    for (const c of candidates) {
      if (normalizeCompanyName(c.name) === normalizedName) {
        return { matchType: 'name_country', matchId: c.id, shouldSkip: true };
      }
    }
  }

  return { matchType: 'none', matchId: null, shouldSkip: false };
}

/**
 * 标准化公司名：去除后缀、标点、多余空格
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(
      /\b(inc\.?|incorporated|llc|ltd\.?|limited|corp\.?|corporation|co\.?|company|gmbh|s\.?a\.?|ag|bv|nv|pty|plc|lp|l\.?p\.?)\b/gi,
      ''
    )
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ==================== 4. Import Chunk ====================

/**
 * 处理一批 PENDING items → 创建 ProspectCompany
 */
export async function processImportChunk(
  batchId: string,
  config: { concurrency: number; chunkSize: number; skipDuplicates: boolean }
): Promise<{ processed: number; imported: number; duplicates: number; failed: number; errors: string[] }> {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: { tenantId: true },
  });

  // 取 PENDING 且 attempts < 3 的行
  const items = await prisma.importBatchItem.findMany({
    where: {
      batchId,
      status: { in: ['PENDING', 'FAILED'] },
      attempts: { lt: 3 },
    },
    orderBy: { rowIndex: 'asc' },
    take: config.chunkSize,
  });

  if (items.length === 0) return { processed: 0, imported: 0, duplicates: 0, failed: 0, errors: [] };

  const result = { processed: items.length, imported: 0, duplicates: 0, failed: 0, errors: [] as string[] };

  // Promise.allSettled with concurrency control
  const chunks = chunkArray(items, config.concurrency);

  for (const chunk of chunks) {
    const settled = await Promise.allSettled(
      chunk.map(async (item) => {
        const data = item.normalizedData as unknown as NormalizedCompanyData;
        if (!data?.displayName) {
          throw new Error(`Row ${item.rowIndex}: missing displayName`);
        }

        // Increment attempts
        await prisma.importBatchItem.update({
          where: { id: item.id },
          data: { attempts: { increment: 1 }, status: 'IMPORTING' },
        });

        // Dedup check
        const dedup = await checkDuplicate(batch.tenantId, data);
        if (dedup.shouldSkip && config.skipDuplicates) {
          await prisma.importBatchItem.update({
            where: { id: item.id },
            data: {
              status: 'DUPLICATE',
              dedupeMatchType: dedup.matchType,
              dedupeMatchId: dedup.matchId,
            },
          });
          return 'duplicate' as const;
        }

        // Create ProspectCompany
        const company = await prisma.prospectCompany.create({
          data: {
            tenantId: batch.tenantId,
            name: data.displayName,
            country: data.country,
            website: data.website,
            industry: data.industry,
            companySize: data.employeeCount,
            description: data.description,
            address: data.address,
            city: data.city,
            phone: data.phone,
            tags: data.tags || [],
            importBatchId: batchId,
            importBatchItemId: item.id,
          },
        });

        // Link item back to company
        await prisma.importBatchItem.update({
          where: { id: item.id },
          data: {
            status: 'IMPORTED',
            prospectCompanyId: company.id,
          },
        });

        return 'imported' as const;
      })
    );

    for (const s of settled) {
      if (s.status === 'fulfilled') {
        if (s.value === 'imported') result.imported++;
        else if (s.value === 'duplicate') result.duplicates++;
      } else {
        result.failed++;
        result.errors.push(s.reason?.message || 'Unknown error');
        // Mark as FAILED
        // Note: item update already done before error
      }
    }
  }

  return result;
}

// ==================== 5. Enrich Chunk ====================

/**
 * 处理一批 IMPORTED items → 调用 enrichProspectCompanyV2
 */
export async function processEnrichChunk(
  batchId: string,
  config: { concurrency: number; chunkSize: number; timeoutMs: number }
): Promise<{ processed: number; enriched: number; failed: number; errors: string[] }> {
  const items = await prisma.importBatchItem.findMany({
    where: {
      batchId,
      status: { in: ['IMPORTED', 'FAILED'] },
      attempts: { lt: 3 },
      prospectCompanyId: { not: null },
    },
    orderBy: { rowIndex: 'asc' },
    take: config.chunkSize,
  });

  if (items.length === 0) return { processed: 0, enriched: 0, failed: 0, errors: [] };

  const result = { processed: items.length, enriched: 0, failed: 0, errors: [] as string[] };
  const chunks = chunkArray(items, config.concurrency);

  for (const chunk of chunks) {
    const settled = await Promise.allSettled(
      chunk.map(async (item) => {
        await prisma.importBatchItem.update({
          where: { id: item.id },
          data: { attempts: { increment: 1 }, status: 'ENRICHING' },
        });

        const enrichResult = await enrichProspectCompanyV2(
          item.prospectCompanyId!,
          { timeout: config.timeoutMs }
        );

        // Mark as ENRICHED regardless (successful API call completed)
        await prisma.importBatchItem.update({
          where: { id: item.id },
          data: { status: 'ENRICHED' },
        });
        return 'enriched' as const;
      })
    );

    for (const s of settled) {
      if (s.status === 'fulfilled') {
        result.enriched++;
      } else {
        result.failed++;
        result.errors.push(s.reason?.message || 'Unknown error');
      }
    }
  }

  return result;
}

// ==================== 6. Cron Tick ====================

/**
 * 一次 cron 调用的完整处理流程
 * 1. 找到一个活跃的 batch (IMPORTING or ENRICHING)
 * 2. 根据当前阶段执行对应处理
 * 3. 检查是否完成，更新 batch 状态
 */
export async function processCronTick(
  overrideConfig?: Partial<CronProcessConfig>
): Promise<CronTickResult | null> {
  const config = { ...DEFAULT_CRON_CONFIG, ...overrideConfig };
  const startTime = Date.now();

  // 找一个正在处理的 batch
  const batch = await prisma.importBatch.findFirst({
    where: {
      status: { in: ['IMPORTING', 'ENRICHING'] },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!batch) return null;

  const result: CronTickResult = {
    batchId: batch.id,
    phase: batch.status === 'IMPORTING' ? 'import' : 'enrich',
    processed: 0,
    remaining: 0,
    errors: [],
    hitDeadline: false,
  };

  if (batch.status === 'IMPORTING') {
    // 导入阶段：循环处理直到没有 pending 或超时
    while (Date.now() - startTime < config.deadlineMs) {
      const chunkResult = await processImportChunk(batch.id, {
        concurrency: config.importConcurrency,
        chunkSize: config.importChunkSize,
        skipDuplicates: true,
      });

      if (chunkResult.processed === 0) break;
      result.processed += chunkResult.processed;
      result.errors.push(...chunkResult.errors);
    }

    if (Date.now() - startTime >= config.deadlineMs) {
      result.hitDeadline = true;
    }

    // 检查是否所有行都已导入
    const pendingCount = await prisma.importBatchItem.count({
      where: {
        batchId: batch.id,
        status: { in: ['PENDING'] },
        attempts: { lt: config.maxAttempts },
      },
    });

    result.remaining = pendingCount;

    if (pendingCount === 0) {
      // 切换到 enrich 阶段
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: 'ENRICHING' },
      });
    }
  } else {
    // ENRICHING 阶段
    while (Date.now() - startTime < config.deadlineMs) {
      const chunkResult = await processEnrichChunk(batch.id, {
        concurrency: config.enrichConcurrency,
        chunkSize: config.enrichChunkSize,
        timeoutMs: 15_000,
      });

      if (chunkResult.processed === 0) break;
      result.processed += chunkResult.processed;
      result.errors.push(...chunkResult.errors);
    }

    if (Date.now() - startTime >= config.deadlineMs) {
      result.hitDeadline = true;
    }

    // 检查是否所有行都已完成
    const pendingCount = await prisma.importBatchItem.count({
      where: {
        batchId: batch.id,
        status: { in: ['IMPORTED', 'FAILED'] },
        attempts: { lt: config.maxAttempts },
        prospectCompanyId: { not: null },
      },
    });

    result.remaining = pendingCount;

    if (pendingCount === 0) {
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: 'COMPLETED',
        },
      });
    }
  }

  return result;
}

// ==================== Utilities ====================

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
