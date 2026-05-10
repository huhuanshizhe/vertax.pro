/**
 * Batch Import 类型定义
 *
 * 支持 XLSX / CSV / Paste 三种来源
 * 字段映射采用 columnMapping 模式，前端选列 → 标准字段
 */

import type {
  ImportBatchStatus,
  ImportBatchItemStatus,
  EnrichmentDepth,
  ImportFileFormat,
} from '@prisma/client';

// ==================== Column Mapping ====================

/** ProspectCompany 标准字段 (导入目标) */
export type ProspectField =
  | 'displayName'
  | 'country'
  | 'website'
  | 'industry'
  | 'employeeCount'
  | 'revenue'
  | 'description'
  | 'address'
  | 'city'
  | 'state'
  | 'phone'
  | 'linkedinUrl'
  | 'tags';

/** 列映射：源列名 → 标准字段 */
export type ColumnMapping = Record<string, ProspectField>;

// ==================== Parse Result ====================

/** 单行解析后的原始数据 */
export interface ParsedRow {
  rowIndex: number;
  raw: Record<string, string>;
  /** 按 columnMapping 转换后的标准化数据 */
  normalized: NormalizedCompanyData;
}

/** 标准化后的公司数据 */
export interface NormalizedCompanyData {
  displayName: string;
  country?: string | null;
  website?: string | null;
  industry?: string | null;
  employeeCount?: string | null;
  revenue?: string | null;
  description?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  tags?: string[];
}

// ==================== Dedup ====================

export type DedupeMatchType = 'domain' | 'name_country' | 'none';

export interface DedupeResult {
  matchType: DedupeMatchType;
  matchId: string | null;
  /** 是否应该跳过（已存在相同记录） */
  shouldSkip: boolean;
}

// ==================== Engine Config ====================

export interface BatchImportConfig {
  tenantId: string;
  userId: string;
  fileFormat: ImportFileFormat;
  columnMapping: ColumnMapping;
  enrichmentDepth: EnrichmentDepth;
  /** 源文件 Asset ID (存储在 Vercel Blob 等) */
  sourceAssetId?: string | null;
  /** 是否跳过重复项 */
  skipDuplicates?: boolean;
}

/** Cron 处理配置 */
export interface CronProcessConfig {
  /** 每批处理行数 (导入阶段) */
  importChunkSize: number;
  /** 导入并发数 */
  importConcurrency: number;
  /** 每批 enrich 行数 */
  enrichChunkSize: number;
  /** enrich 并发数 */
  enrichConcurrency: number;
  /** 整体超时 (ms) */
  deadlineMs: number;
  /** 最大失败重试次数 */
  maxAttempts: number;
}

export const DEFAULT_CRON_CONFIG: CronProcessConfig = {
  importChunkSize: 50,
  importConcurrency: 10,
  enrichChunkSize: 15,
  enrichConcurrency: 3,
  deadlineMs: 55_000, // Vercel cron max ~60s, 留 5s buffer
  maxAttempts: 3,
};

// ==================== Engine Results ====================

export interface ImportResult {
  totalRows: number;
  imported: number;
  duplicates: number;
  failed: number;
  errors: string[];
}

export interface EnrichResult {
  processed: number;
  enriched: number;
  failed: number;
  errors: string[];
}

export interface CronTickResult {
  batchId: string;
  phase: 'import' | 'enrich';
  processed: number;
  remaining: number;
  errors: string[];
  hitDeadline: boolean;
}

// ==================== Re-exports ====================
export type {
  ImportBatchStatus,
  ImportBatchItemStatus,
  EnrichmentDepth,
  ImportFileFormat,
};
