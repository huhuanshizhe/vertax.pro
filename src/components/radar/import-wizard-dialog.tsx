'use client';

/**
 * ImportWizardDialog - 批量导入线索向导
 *
 * 三步流程:
 * 1. 上传文件 (XLSX/CSV 拖拽或选择)
 * 2. 列映射 (源列 → 标准字段)
 * 3. 预览确认 (前 5 行预览 + 开始导入)
 */

import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Upload,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  parseImportFile,
  confirmImport,
  type ParsePreviewResult,
} from '@/actions/batch-import';
import type { ColumnMapping } from '@/lib/radar/batch-import-types';
import { toast } from 'sonner';

// ==================== 标准字段定义 ====================

const PROSPECT_FIELDS: { value: string; label: string }[] = [
  { value: '', label: '-- 不导入 --' },
  { value: 'displayName', label: '公司名称' },
  { value: 'country', label: '国家/地区' },
  { value: 'website', label: '官网' },
  { value: 'industry', label: '行业' },
  { value: 'employeeCount', label: '员工规模' },
  { value: 'description', label: '公司简介' },
  { value: 'address', label: '地址' },
  { value: 'city', label: '城市' },
  { value: 'phone', label: '电话' },
  { value: 'tags', label: '标签 (逗号分隔)' },
];

// 自动匹配规则: 源列名关键词 → 标准字段
const AUTO_MATCH_RULES: Record<string, string> = {
  'company': 'displayName',
  'name': 'displayName',
  '公司': 'displayName',
  '名称': 'displayName',
  'country': 'country',
  '国家': 'country',
  '地区': 'country',
  'website': 'website',
  'url': 'website',
  '官网': 'website',
  '网址': 'website',
  'industry': 'industry',
  '行业': 'industry',
  'employee': 'employeeCount',
  '规模': 'employeeCount',
  '人数': 'employeeCount',
  'description': 'description',
  '简介': 'description',
  '描述': 'description',
  'address': 'address',
  '地址': 'address',
  'city': 'city',
  '城市': 'city',
  'phone': 'phone',
  '电话': 'phone',
  'tag': 'tags',
  '标签': 'tags',
};

function autoMatchColumn(header: string): string {
  const lower = header.toLowerCase().trim();
  for (const [keyword, field] of Object.entries(AUTO_MATCH_RULES)) {
    if (lower.includes(keyword)) return field;
  }
  return '';
}

// ==================== Props ====================

interface ImportWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete?: () => void;
}

type Step = 'upload' | 'mapping' | 'preview';

// ==================== Component ====================

export function ImportWizardDialog({
  open,
  onOpenChange,
  onImportComplete,
}: ImportWizardDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsePreviewResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [enrichAfterImport, setEnrichAfterImport] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formDataRef = useRef<FormData | null>(null);

  // Reset state when dialog closes
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setStep('upload');
      setFile(null);
      setParsing(false);
      setSubmitting(false);
      setError(null);
      setPreview(null);
      setMapping({});
      formDataRef.current = null;
    }
    onOpenChange(open);
  }, [onOpenChange]);

  // ==================== Step 1: Upload ====================

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setParsing(true);

    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      formDataRef.current = fd;

      const result = await parseImportFile(fd);

      if (!result.success) {
        setError(result.error);
        setParsing(false);
        return;
      }

      setPreview(result.data);

      // Auto-match columns
      const autoMapping: Record<string, string> = {};
      for (const header of result.data.headers) {
        const matched = autoMatchColumn(header);
        if (matched) {
          autoMapping[header] = matched;
        }
      }
      setMapping(autoMapping);

      setParsing(false);
      setStep('mapping');
    } catch {
      setError('文件解析失败，请检查文件格式');
      setParsing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // ==================== Step 2: Mapping ====================

  const handleMappingChange = useCallback((header: string, field: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (field) {
        next[header] = field;
      } else {
        delete next[header];
      }
      return next;
    });
  }, []);

  const hasDisplayName = Object.values(mapping).includes('displayName');

  // ==================== Step 3: Confirm ====================

  const handleConfirm = useCallback(async () => {
    if (!formDataRef.current) return;
    setSubmitting(true);
    setError(null);

    try {
      // Rebuild FormData (it may be consumed)
      const fd = new FormData();
      fd.append('file', file!);

      const columnMapping: ColumnMapping = {};
      for (const [header, field] of Object.entries(mapping)) {
        if (field) {
          columnMapping[header] = field as any;
        }
      }

      const result = await confirmImport(fd, columnMapping, {
        enrichmentDepth: enrichAfterImport ? 'BASIC' : 'BASIC',
        skipDuplicates: true,
      });

      if (!result.success) {
        setError(result.error);
        setSubmitting(false);
        return;
      }

      toast.success('导入任务已创建', {
        description: `共 ${preview?.totalRows || 0} 条数据，系统正在后台处理中`,
      });

      handleOpenChange(false);
      onImportComplete?.();
    } catch {
      setError('导入失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }, [file, mapping, enrichAfterImport, preview, handleOpenChange, onImportComplete]);

  // ==================== Render ====================

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[#0B1B2B]">
            导入线索
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {step === 'upload' && '上传 Excel 或 CSV 文件，批量导入潜在客户数据'}
            {step === 'mapping' && '将文件中的列对应到系统字段'}
            {step === 'preview' && '确认数据预览，开始导入'}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 py-2">
          {(['upload', 'mapping', 'preview'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="w-8 h-px bg-slate-200" />}
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  step === s
                    ? 'bg-[#0B1220] text-[var(--ci-accent)]'
                    : s === 'upload' && step !== 'upload'
                    ? 'bg-emerald-100 text-emerald-600'
                    : s === 'mapping' && step === 'preview'
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                {(s === 'upload' && step !== 'upload') || (s === 'mapping' && step === 'preview')
                  ? <Check size={12} />
                  : i + 1
                }
              </div>
              <span className={`text-xs ${step === s ? 'text-[#0B1B2B] font-medium' : 'text-slate-400'}`}>
                {s === 'upload' ? '上传文件' : s === 'mapping' ? '列映射' : '确认导入'}
              </span>
            </div>
          ))}
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-600 text-xs">
            <AlertCircle size={14} />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-3 p-10 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-[var(--ci-accent)] hover:bg-slate-50/50 transition-colors"
          >
            {parsing ? (
              <>
                <Loader2 size={32} className="text-[var(--ci-accent)] animate-spin" />
                <span className="text-sm text-slate-500">正在解析文件...</span>
              </>
            ) : file ? (
              <>
                <FileSpreadsheet size={32} className="text-[var(--ci-accent)]" />
                <span className="text-sm font-medium text-[#0B1B2B]">{file.name}</span>
                <span className="text-xs text-slate-400">点击重新选择</span>
              </>
            ) : (
              <>
                <Upload size={32} className="text-slate-300" />
                <span className="text-sm text-slate-500">
                  拖放文件到此处，或点击选择
                </span>
                <span className="text-xs text-slate-400">
                  支持 .xlsx、.csv 格式
                </span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.tsv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
            />
          </div>
        )}

        {/* Step 2: Column Mapping */}
        {step === 'mapping' && preview && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              已识别 {preview.headers.length} 列，共 {preview.totalRows} 行数据。
              请为每列选择对应的系统字段。
            </p>
            <div className="max-h-[40vh] overflow-y-auto space-y-2 pr-1">
              {preview.headers.map((header) => (
                <div
                  key={header}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-100 bg-slate-50/50"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-[#0B1B2B] truncate block">
                      {header}
                    </span>
                    <span className="text-[10px] text-slate-400 truncate block">
                      {preview.sampleRows[0]?.[header] || '-'}
                    </span>
                  </div>
                  <ArrowRight size={14} className="text-slate-300 shrink-0" />
                  <select
                    value={mapping[header] || ''}
                    onChange={(e) => handleMappingChange(header, e.target.value)}
                    className="w-36 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-[var(--ci-accent)]"
                  >
                    {PROSPECT_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {!hasDisplayName && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle size={12} />
                请至少将一列映射为"公司名称"
              </p>
            )}
          </div>
        )}

        {/* Step 3: Preview & Confirm */}
        {step === 'preview' && preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-slate-50 text-center">
                <div className="text-lg font-bold text-[#0B1B2B]">{preview.totalRows}</div>
                <div className="text-xs text-slate-500">总行数</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 text-center">
                <div className="text-lg font-bold text-[#0B1B2B]">
                  {Object.values(mapping).filter(Boolean).length}
                </div>
                <div className="text-xs text-slate-500">映射字段</div>
              </div>
              <div className="p-3 rounded-lg bg-emerald-50 text-center">
                <div className="text-lg font-bold text-emerald-600">
                  {enrichAfterImport ? '是' : '否'}
                </div>
                <div className="text-xs text-slate-500">自动补全</div>
              </div>
            </div>

            {/* Data preview table */}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50">
                    {Object.entries(mapping)
                      .filter(([, v]) => v)
                      .map(([header, field]) => (
                        <th key={header} className="px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap">
                          {PROSPECT_FIELDS.find((f) => f.value === field)?.label || field}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {Object.entries(mapping)
                        .filter(([, v]) => v)
                        .map(([header]) => (
                          <td key={header} className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-[200px] truncate">
                            {row[header] || '-'}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Options */}
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={enrichAfterImport}
                onChange={(e) => setEnrichAfterImport(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-[var(--ci-accent)]"
              />
              导入后自动补全企业信息和联系人
            </label>
          </div>
        )}

        {/* Footer */}
        <DialogFooter className="gap-2">
          {step !== 'upload' && (
            <button
              onClick={() => setStep(step === 'preview' ? 'mapping' : 'upload')}
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
            >
              <ArrowLeft size={12} />
              上一步
            </button>
          )}
          <div className="flex-1" />
          {step === 'mapping' && (
            <button
              onClick={() => setStep('preview')}
              disabled={!hasDisplayName}
              className="px-4 py-2 text-xs font-medium text-white bg-[#0B1220] rounded-lg hover:bg-[#0B1220]/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              下一步
              <ArrowRight size={12} />
            </button>
          )}
          {step === 'preview' && (
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-white bg-[#0B1220] rounded-lg hover:bg-[#0B1220]/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {submitting ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  导入中...
                </>
              ) : (
                <>
                  <Check size={12} />
                  确认导入 ({preview?.totalRows} 条)
                </>
              )}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
