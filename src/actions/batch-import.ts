'use server';

/**
 * Batch Import Server Actions
 *
 * 供 ImportWizardDialog 前端组件调用。
 * 流程: 上传文件 → 解析预览 → 确认列映射 → 创建 batch → cron 异步处理
 */

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  parseFileBuffer,
  createBatchWithItems,
} from '@/lib/radar/batch-import-engine';
import type {
  ColumnMapping,
  NormalizedCompanyData,
  ImportFileFormat,
  EnrichmentDepth,
} from '@/lib/radar/batch-import-types';

// ==================== Types ====================

export interface ParsePreviewResult {
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
}

export interface ImportBatchSummary {
  id: string;
  status: string;
  totalRows: number;
  importedCount: number;
  enrichedCount: number;
  failedCount: number;
  duplicateCount: number;
  createdAt: string;
}

// ==================== Actions ====================

/**
 * 解析上传的文件，返回列头和前 5 行数据供预览
 */
export async function parseImportFile(
  formData: FormData
): Promise<{ success: true; data: ParsePreviewResult } | { success: false; error: string }> {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return { success: false, error: '未登录' };
  }

  try {
    const file = formData.get('file') as File | null;
    if (!file) {
      return { success: false, error: '未选择文件' };
    }

    const fileName = file.name.toLowerCase();
    let format: 'XLSX' | 'CSV';
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      format = 'XLSX';
    } else if (fileName.endsWith('.csv') || fileName.endsWith('.tsv')) {
      format = 'CSV';
    } else {
      return { success: false, error: '仅支持 .xlsx 或 .csv 文件' };
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 用一个 identity mapping 先解析出原始列头
    // parseFileBuffer 需要 mapping，先用空映射提取 raw 行
    const XLSX = await import('xlsx');
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
      const { parse: csvParse } = await import('csv-parse/sync');
      const text = buffer.toString('utf-8');
      rawRows = csvParse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      }) as Record<string, string>[];
    }

    if (rawRows.length === 0) {
      return { success: false, error: '文件为空或格式不正确' };
    }

    const headers = Object.keys(rawRows[0]);
    const sampleRows = rawRows.slice(0, 5);

    return {
      success: true,
      data: {
        headers,
        sampleRows,
        totalRows: rawRows.length,
      },
    };
  } catch (err) {
    console.error('[parseImportFile] Error:', err);
    return { success: false, error: err instanceof Error ? err.message : '解析失败' };
  }
}

/**
 * 确认导入：创建 ImportBatch + Items，cron 后续处理
 */
export async function confirmImport(
  formData: FormData,
  columnMapping: ColumnMapping,
  options: {
    enrichmentDepth: EnrichmentDepth;
    skipDuplicates: boolean;
  }
): Promise<{ success: true; batchId: string } | { success: false; error: string }> {
  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return { success: false, error: '未登录' };
  }

  try {
    const file = formData.get('file') as File | null;
    if (!file) {
      return { success: false, error: '未选择文件' };
    }

    const fileName = file.name.toLowerCase();
    let fileFormat: ImportFileFormat;
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      fileFormat = 'XLSX';
    } else {
      fileFormat = 'CSV';
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseFileBuffer(buffer, fileFormat, columnMapping);

    if (rows.length === 0) {
      return { success: false, error: '文件为空' };
    }

    const batchId = await createBatchWithItems(
      {
        tenantId: session.user.tenantId,
        userId: session.user.id,
        fileFormat,
        columnMapping,
        enrichmentDepth: options.enrichmentDepth,
        skipDuplicates: options.skipDuplicates,
      },
      rows
    );

    return { success: true, batchId };
  } catch (err) {
    console.error('[confirmImport] Error:', err);
    return { success: false, error: err instanceof Error ? err.message : '导入失败' };
  }
}

/**
 * 获取 ImportBatch 列表（当前租户）
 */
export async function getImportBatches(): Promise<ImportBatchSummary[]> {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const batches = await prisma.importBatch.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return batches.map((b) => ({
    id: b.id,
    status: b.status,
    totalRows: b.totalRows,
    importedCount: b.importedCount,
    enrichedCount: b.enrichedCount,
    failedCount: b.failedCount,
    duplicateCount: b.duplicateCount,
    createdAt: b.createdAt.toISOString(),
  }));
}

/**
 * 获取单个 batch 的状态
 */
export async function getImportBatchStatus(
  batchId: string
): Promise<ImportBatchSummary | null> {
  const session = await auth();
  if (!session?.user?.tenantId) return null;

  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, tenantId: session.user.tenantId },
  });

  if (!batch) return null;

  return {
    id: batch.id,
    status: batch.status,
    totalRows: batch.totalRows,
    importedCount: batch.importedCount,
    enrichedCount: batch.enrichedCount,
    failedCount: batch.failedCount,
    duplicateCount: batch.duplicateCount,
    createdAt: batch.createdAt.toISOString(),
  };
}
