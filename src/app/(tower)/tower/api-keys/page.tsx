"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Eye, EyeOff, Save, RefreshCw, Check, X, ExternalLink, Activity, AlertCircle } from "lucide-react";

// ==================== Service Configs ====================

interface ServiceConfig {
  service: string;
  name: string;
  category: string;
  description: string;
  requiresSecret?: boolean;
  docUrl?: string;
  freeQuota?: string;
  pricing?: string;
}

const SERVICE_CONFIGS: ServiceConfig[] = [
  // AI Provider
  {
    service: "dashscope",
    name: "DashScope (千问百炼)",
    category: "AI Provider",
    description: "阿里云 AI 服务，主要 AI 提供商",
    docUrl: "https://dashscope.console.aliyun.com/",
    freeQuota: "有免费额度",
  },
  {
    service: "openrouter",
    name: "OpenRouter",
    category: "AI Provider",
    description: "多模型聚合 API，备用 AI 提供商",
    docUrl: "https://openrouter.ai/keys",
    freeQuota: "按模型计费",
  },
  {
    service: "gemini",
    name: "Google Gemini",
    category: "AI Provider",
    description: "Google AI 服务，用于 Lead Discovery",
    docUrl: "https://aistudio.google.com/apikey",
    freeQuota: "有免费额度",
  },
  // Search API
  {
    service: "brave_search",
    name: "Brave Search",
    category: "搜索 API",
    description: "隐私优先的搜索 API，B2B 发现",
    docUrl: "https://brave.com/search/api/",
    freeQuota: "2000次/月",
    pricing: "$5/1000次",
  },
  {
    service: "tavily",
    name: "Tavily",
    category: "搜索 API",
    description: "AI 原生搜索，专为 RAG 和 Agent 设计",
    docUrl: "https://tavily.com",
    freeQuota: "1000次/月",
    pricing: "$8/1000次",
  },
  {
    service: "exa",
    name: "Exa",
    category: "搜索 API",
    description: "神经语义搜索，研究友好",
    docUrl: "https://exa.ai",
    freeQuota: "1000次/月",
    pricing: "$1.5/1000次",
  },
  {
    service: "firecrawl",
    name: "Firecrawl",
    category: "网页抓取",
    description: "LLM-ready web scraping and extraction",
    docUrl: "https://www.firecrawl.dev/",
    freeQuota: "按套餐计费",
  },
  {
    service: "serper",
    name: "Serper",
    category: "搜索 API",
    description: "便宜的 Google 搜索 API",
    docUrl: "https://serper.dev",
    pricing: "$0.3-1/1000次",
  },
  // Enterprise Data
  {
    service: "google_places",
    name: "Google Places",
    category: "企业数据",
    description: "Google Maps 企业发现 API",
    docUrl: "https://console.cloud.google.com/apis/credentials",
    freeQuota: "$200/月额度",
  },
  {
    service: "hunter",
    name: "Hunter.io",
    category: "企业数据",
    description: "邮箱查找和验证",
    docUrl: "https://hunter.io/api-keys",
    freeQuota: "25次/月",
    pricing: "$49/月起",
  },
  {
    service: "pdl",
    name: "People Data Labs",
    category: "企业数据",
    description: "联系人和公司数据丰富化",
    docUrl: "https://www.peopledatalabs.com/dashboard",
    pricing: "按查询计费",
  },
  {
    service: "apollo",
    name: "Apollo.io",
    category: "企业数据",
    description: "公司+联系人数据丰富化",
    docUrl: "https://app.apollo.io/#/settings/integrations/api",
    freeQuota: "50次/月",
  },
  {
    service: "skrapp",
    name: "Skrapp.io",
    category: "企业数据",
    description: "LinkedIn 邮箱查找",
    docUrl: "https://skrapp.io/dashboard/api",
    freeQuota: "100次/月",
  },
  // Government
  {
    service: "sam_gov",
    name: "SAM.gov",
    category: "政府采购",
    description: "美国联邦政府采购",
    docUrl: "https://sam.gov",
    freeQuota: "免费（需注册）",
  },
  {
    service: "ungm",
    name: "UNGM",
    category: "政府采购",
    description: "联合国采购平台",
    docUrl: "https://developer.ungm.org/",
    requiresSecret: true,
  },
];

// ==================== Types ====================

interface ApiKeyConfig {
  id: string;
  service: string;
  apiKey: string | null;
  apiSecret: string | null;
  isEnabled: boolean;
  lastUsedAt: string | null;
  monthlyLimit: number | null;
  currentUsage: number;
  usageResetAt: string | null;
  notes: string | null;
  source?: "database" | "env" | "none";
}

interface ApiHealthStatus {
  code: string;
  name: string;
  category: string;
  provider: string;
  isConfigured: boolean;
  isFree: boolean;
  monthlyFreeQuota: number;
  todayUsage: {
    calls: number;
    success: number;
    errors: number;
    lastError?: string;
    lastErrorAt?: string;
    avgLatencyMs: number;
  };
  quotaStatus: 'healthy' | 'warning' | 'exhausted' | 'unknown';
  quotaMessage: string;
}

// ==================== Main Component ====================

export default function TowerApiKeysPage() {
  const [configs, setConfigs] = useState<ApiKeyConfig[]>([]);
  const [healthData, setHealthData] = useState<Map<string, ApiHealthStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    loadConfigs();
    loadHealthData();
  }, []);

  const loadConfigs = async () => {
    try {
      const response = await fetch("/api/admin/api-keys");
      if (response.ok) {
        const data = await response.json();
        setConfigs(data.configs || []);
      }
    } catch {
      toast.error("加载配置失败");
    } finally {
      setLoading(false);
    }
  };

  const loadHealthData = async () => {
    try {
      const response = await fetch("/api/admin/api-health");
      if (response.ok) {
        const data = await response.json();
        const healthMap = new Map<string, ApiHealthStatus>();
        for (const api of data.apis || []) {
          healthMap.set(api.code, api);
        }
        setHealthData(healthMap);
      }
    } catch (error) {
      console.error("Failed to load health data:", error);
    }
  };

  const testConnection = async (service: string) => {
    setTesting(service);
    try {
      // 调用测试端点真正测试 API 连接
      const response = await fetch("/api/admin/api-keys/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`${service} 连接成功 (${data.latency})`);
        // 刷新健康数据
        await loadHealthData();
      } else {
        toast.error(`${service} 连接失败: ${data.error || '未知错误'}`);
      }
    } catch (error) {
      console.error("Test connection error:", error);
      toast.error("测试连接失败");
    } finally {
      setTesting(null);
    }
  };

  const saveConfig = async (
    service: string,
    apiKey: string,
    apiSecret?: string
  ) => {
    setSaving(service);
    try {
      const response = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, apiKey, apiSecret }),
      });
      if (response.ok) {
        toast.success(`${service} 配置已保存`);
        loadConfigs();
      } else {
        toast.error("保存失败");
      }
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(null);
    }
  };

  const toggleEnabled = async (service: string, isEnabled: boolean) => {
    try {
      const response = await fetch("/api/admin/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, isEnabled }),
      });
      if (response.ok) {
        toast.success(`${service} 已${isEnabled ? "启用" : "禁用"}`);
        loadConfigs();
      }
    } catch {
      toast.error("操作失败");
    }
  };

  const getConfig = (service: string) =>
    configs.find((c) => c.service === service);

  // 获取环境变量名称
  const getEnvVarName = (service: string): string => {
    const envVarMap: Record<string, string> = {
      dashscope: "TEXT_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
      gemini: "GEMINI_API_KEY",
      brave_search: "BRAVE_SEARCH_API_KEY",
      tavily: "TAVILY_API_KEY",
      exa: "EXA_API_KEY",
      firecrawl: "FIRECRAWL_API_KEY",
      serper: "SERPER_API_KEY",
      serpapi: "SERPAPI_API_KEY",
      google_places: "GOOGLE_MAPS_API_KEY",
      hunter: "HUNTER_API_KEY",
      pdl: "PDL_API_KEY",
      apollo: "APOLLO_API_KEY",
      skrapp: "SKRAPP_API_KEY",
      sam_gov: "SAM_GOV_API_KEY",
      ungm: "UNGM_CLIENT_ID",
      resend: "RESEND_API_KEY",
    };
    return envVarMap[service] || "未知";
  };

  const grouped = SERVICE_CONFIGS.reduce((acc, s) => {
    if (!acc[s.category]) acc[s.category] = [];
    acc[s.category].push(s);
    return acc;
  }, {} as Record<string, ServiceConfig[]>);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const configuredCount = configs.filter((c) => c.apiKey).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">API 密钥管理</h1>
        <p className="text-sm text-gray-500 mt-1">
          配置第三方服务密钥 · 已配置 {configuredCount}/{SERVICE_CONFIGS.length} 个服务
        </p>
      </div>

      {Object.entries(grouped).map(([category, services]) => (
        <div key={category} className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            {category}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {services.map((sc) => {
              const config = getConfig(sc.service);
              const health = healthData.get(sc.service);
              const isConfigured = !!config?.apiKey || health?.isConfigured;
              const showKey = showKeys[sc.service];

              // 获取部分 key 预览
              const getKeyPreview = () => {
                if (!config?.apiKey || config.apiKey === "************") {
                  if (health?.isConfigured) {
                    // 显示环境变量名称和状态
                    const envVar = getEnvVarName(sc.service);
                    if (health.todayUsage.calls > 0) {
                      return `✓ 已配置 (${envVar}) - 今日 ${health.todayUsage.calls} 次调用`;
                    }
                    return `✓ 已配置 (${envVar}) - 等待首次调用`;
                  }
                  return null;
                }
                // 显示前 4 位和后 4 位
                const key = config.apiKey;
                if (key.length > 12) {
                  return `${key.slice(0, 4)}****${key.slice(-4)}`;
                }
                return key;
              };

              const keyPreview = getKeyPreview();

              return (
                <div
                  key={sc.service}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
                >
                  {/* Card Header */}
                  <div className="px-5 py-4 border-b border-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-semibold text-gray-900">
                          {sc.name}
                        </span>
                        {isConfigured ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-600">
                            <Check className="h-2.5 w-2.5" />
                            {config?.source === "env" ? "环境变量" : "已配置"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                            <X className="h-2.5 w-2.5" />
                            未配置
                          </span>
                        )}
                      </div>
                      <Switch
                        checked={config?.isEnabled ?? false}
                        onCheckedChange={(checked) =>
                          toggleEnabled(sc.service, checked)
                        }
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {sc.description}
                    </p>
                  </div>

                  {/* Card Body */}
                  <div className="px-5 py-4 space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">API Key</Label>
                        <div className="flex items-center gap-2">
                          {sc.docUrl && (
                            <a
                              href={sc.docUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-blue-500 hover:underline flex items-center gap-0.5"
                            >
                              获取 <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                          {isConfigured && (
                            <button
                              onClick={() => testConnection(sc.service)}
                              disabled={testing === sc.service}
                              className="text-[10px] text-blue-500 hover:underline flex items-center gap-0.5 disabled:opacity-50"
                            >
                              {testing === sc.service ? (
                                <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                              ) : (
                                <Activity className="h-2.5 w-2.5" />
                              )}
                              测试
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={showKey ? "text" : "password"}
                            placeholder="输入 API Key"
                            defaultValue={config?.apiKey || ""}
                            id={`key-${sc.service}`}
                            className="text-xs h-9"
                          />
                          <button
                            type="button"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            onClick={() =>
                              setShowKeys((prev) => ({
                                ...prev,
                                [sc.service]: !prev[sc.service],
                              }))
                            }
                          >
                            {showKey ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                      {keyPreview && (
                        <p className="text-[10px] text-gray-500 mt-1">
                          {keyPreview}
                        </p>
                      )}
                    </div>

                    {sc.requiresSecret && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">API Secret</Label>
                        <Input
                          type="password"
                          placeholder="输入 API Secret"
                          defaultValue={config?.apiSecret || ""}
                          id={`secret-${sc.service}`}
                          className="text-xs h-9"
                        />
                      </div>
                    )}

                    {/* 健康状态和用量 */}
                    {health && isConfigured && (
                      <div className="pt-2 border-t border-gray-100 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {health.quotaStatus === 'healthy' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-600">
                                <Activity className="h-2.5 w-2.5" />
                                正常
                              </span>
                            )}
                            {health.quotaStatus === 'warning' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-50 text-yellow-600">
                                <AlertCircle className="h-2.5 w-2.5" />
                                警告
                              </span>
                            )}
                            {health.quotaStatus === 'exhausted' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600">
                                <X className="h-2.5 w-2.5" />
                                耗尽
                              </span>
                            )}
                          </div>
                          {health.todayUsage.avgLatencyMs > 0 && (
                            <span className="text-[10px] text-gray-400">
                              平均延迟: {health.todayUsage.avgLatencyMs}ms
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-gray-400">
                          <span>
                            今日: {health.todayUsage.calls} 次调用
                            {health.todayUsage.errors > 0 && (
                              <span className="text-red-500"> ({health.todayUsage.errors} 错误)</span>
                            )}
                          </span>
                          {health.monthlyFreeQuota > 0 && health.monthlyFreeQuota < 999999 && (
                            <span>免费额度: {health.monthlyFreeQuota}/月</span>
                          )}
                        </div>
                        {health.quotaMessage && (
                          <p className="text-[10px] text-gray-500">{health.quotaMessage}</p>
                        )}
                        {health.todayUsage.lastError && (
                          <p className="text-[10px] text-red-500">
                            最近错误: {health.todayUsage.lastError.slice(0, 100)}
                          </p>
                        )}
                      </div>
                    )}

                    {!isConfigured && (
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-3 text-[10px] text-gray-400">
                          {sc.freeQuota && <span>免费: {sc.freeQuota}</span>}
                          {sc.pricing && <span>价格: {sc.pricing}</span>}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-3 text-[10px] text-gray-400">
                        {config && config.currentUsage > 0 && (
                          <span>
                            本月: {config.currentUsage}次
                            {config.monthlyLimit &&
                              ` / ${config.monthlyLimit}次`}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          const keyEl = document.getElementById(
                            `key-${sc.service}`
                          ) as HTMLInputElement;
                          const secretEl = document.getElementById(
                            `secret-${sc.service}`
                          ) as HTMLInputElement;
                          saveConfig(
                            sc.service,
                            keyEl?.value || "",
                            secretEl?.value
                          );
                        }}
                        disabled={saving === sc.service}
                      >
                        {saving === sc.service ? (
                          <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Save className="h-3 w-3 mr-1" />
                        )}
                        保存
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
