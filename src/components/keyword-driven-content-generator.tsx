"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "@/lib/languages";
import { Loader2, Sparkles, TrendingUp, FileText, Image as ImageIcon, CheckCircle2, AlertCircle, ChevronRight, Copy, ExternalLink, Send, ShieldCheck } from "lucide-react";

// ==================== 类型 ====================

type KeywordMetric = { searchVolume: number; competition: "low" | "medium" | "high"; commercialIntent: number; relevance: number };
type CoreKeyword = { id: string; term: string; category: string; metrics: KeywordMetric; confidence: number };
type LongTailKeyword = { id: string; coreKeywordId: string; term: string; category: string; metrics: KeywordMetric; contentAngle?: string; searchIntent?: string };
type GeneratedContent = { text: string; hashtags: string[]; cta?: string; imagePrompt?: string; platform?: string; metadata: { keywordUsed: string; searchIntent: string; contentAngle: string; estimatedReadTime: number } };
type StepState = "idle" | "loading" | "complete";

// 平台配置
const ALL_PLATFORMS = [
  { id: "linkedin", name: "LinkedIn", icon: "🔗", color: "bg-blue-700", ringColor: "ring-blue-500" },
  { id: "x", name: "X", icon: "𝕏", color: "bg-slate-800", ringColor: "ring-slate-500" },
  { id: "facebook", name: "Facebook", icon: "📘", color: "bg-blue-600", ringColor: "ring-blue-400" },
  { id: "instagram", name: "Instagram", icon: "📷", color: "bg-pink-600", ringColor: "ring-pink-400" },
  { id: "youtube", name: "YouTube", icon: "▶️", color: "bg-red-600", ringColor: "ring-red-400" },
  { id: "tiktok", name: "TikTok", icon: "🎵", color: "bg-neutral-950", ringColor: "ring-neutral-400" },
];

// ==================== 主组件 ====================

export default function KeywordDrivenContentGenerator() {
  const [step1, setStep1] = useState<StepState>("idle");
  const [step2, setStep2] = useState<StepState>("idle");
  const [step3, setStep3] = useState<StepState>("idle");
  const [activeStep, setActiveStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [coreKeywords, setCoreKeywords] = useState<CoreKeyword[]>([]);
  const [longTailKeywords, setLongTailKeywords] = useState<LongTailKeyword[]>([]);
  const [contents, setContents] = useState<GeneratedContent[]>([]);
  const [step1Stats, setStep1Stats] = useState({ total: 0, avgVol: 0, highValue: 0 });
  const [step2Stats, setStep2Stats] = useState({ total: 0, avgVol: 0, highValue: 0 });
  const [step3Stats, setStep3Stats] = useState({ total: 0, success: 0, failed: 0, avgLen: 0 });

  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [maxCoreKeywords, setMaxCoreKeywords] = useState(30);
  const [maxPerCore, setMaxPerCore] = useState(10);
  const [platforms, setPlatforms] = useState<string[]>(ALL_PLATFORMS.map(p => p.id));
  const [tone, setTone] = useState("professional");

  const [selectedCoreIds, setSelectedCoreIds] = useState<string[]>([]);
  const [selectedLongTailIds, setSelectedLongTailIds] = useState<string[]>([]);

  // 每个关键词当前选中的平台
  const [activePlatformByKeyword, setActivePlatformByKeyword] = useState<Record<string, string>>({});

  // 配图生成状态
  const [generatedImages, setGeneratedImages] = useState<Record<string, string | null>>({});

  // 审核 & 发布状态 (key = "keyword|platform")
  const [approvedItems, setApprovedItems] = useState<Record<string, boolean>>({});
  const [publishingItems, setPublishingItems] = useState<Record<string, boolean>>({});
  const [publishedItems, setPublishedItems] = useState<Record<string, boolean>>({});

  const itemKey = (kw: string, plat: string) => `${kw}|${plat}`;

  // 发布单篇内容
  const handlePublish = async (content: GeneratedContent) => {
    const key = itemKey(content.metadata.keywordUsed, content.platform || "linkedin");
    if (!approvedItems[key]) { alert("请先审核通过再发布"); return; }
    setPublishingItems(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/social/publish-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: content.platform,
          content: content.text,
          hashtags: content.hashtags,
          keyword: content.metadata.keywordUsed,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPublishedItems(prev => ({ ...prev, [key]: true }));
        alert(`已发布到 ${content.platform}！`);
      } else {
        alert(data.error || "发布失败");
      }
    } catch {
      alert("发布失败，请重试");
    } finally {
      setPublishingItems(prev => ({ ...prev, [key]: false }));
    }
  };

  // 按关键词分组
  const keywordGroups = useMemo(() => {
    const map: Record<string, GeneratedContent[]> = {};
    for (const c of contents) {
      const kw = c.metadata.keywordUsed;
      if (!map[kw]) map[kw] = [];
      map[kw].push(c);
    }
    return map;
  }, [contents]);

  const keywordList = Object.keys(keywordGroups);

  // 加载已保存数据
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/social/keywords");
        const data = await res.json();
        if (!data.success || !data.data) return;
        const saved = data.data;
        if (saved.coreKeywords?.length > 0) {
          setCoreKeywords(saved.coreKeywords);
          setStep1("complete");
          setStep1Stats({ total: saved.coreKeywords.length, avgVol: calcAvg(saved.coreKeywords), highValue: saved.coreKeywords.filter((k: any) => k.metrics?.commercialIntent > 0.7).length });
          setActiveStep(2);
        }
        if (saved.longTailKeywords?.length > 0) {
          setLongTailKeywords(saved.longTailKeywords);
          setStep2("complete");
          setStep2Stats({ total: saved.longTailKeywords.length, avgVol: calcAvg(saved.longTailKeywords), highValue: saved.longTailKeywords.filter((k: any) => k.metrics?.commercialIntent > 0.7).length });
          setActiveStep(3);
        }
        if (saved.generatedContents?.length > 0) {
          setContents(saved.generatedContents);
          setStep3("complete");
        }
        if (saved.config) {
          if (saved.config.language) setLanguage(saved.config.language);
          if (saved.config.maxCoreKeywords) setMaxCoreKeywords(saved.config.maxCoreKeywords);
        }
      } catch { /* noop */ }
    })();
  }, []);

  // ===== Step 1 =====
  const handleStep1 = async () => {
    setStep1("loading"); setError(null);
    try {
      const res = await fetch("/api/social/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "extract", maxCoreKeywords, language }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setCoreKeywords(data.data.coreKeywords);
      setStep1Stats(data.data.stats);
      setStep1("complete"); setActiveStep(2);
    } catch (err) { setError(err instanceof Error ? err.message : "提取失败"); setStep1("idle"); }
  };

  // ===== Step 2 =====
  const handleStep2 = async () => {
    const kw = selectedCoreIds.length > 0 ? coreKeywords.filter(k => selectedCoreIds.includes(k.id)) : coreKeywords;
    if (kw.length === 0) { setError("请先完成步骤1"); return; }
    setStep2("loading"); setError(null);
    try {
      const res = await fetch("/api/social/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "expand", coreKeywords: kw, maxPerCore, language }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setLongTailKeywords(data.data.longTailKeywords);
      setStep2Stats(data.data.stats);
      setStep2("complete"); setActiveStep(3);
    } catch (err) { setError(err instanceof Error ? err.message : "裂变失败"); setStep2("idle"); }
  };

  // ===== Step 3 =====
  const handleStep3 = async () => {
    const toUse = selectedLongTailIds.length > 0 ? longTailKeywords.filter(k => selectedLongTailIds.includes(k.id)) : longTailKeywords.slice(0, 20);
    if (toUse.length === 0) { setError("请先完成步骤2"); return; }
    if (platforms.length === 0) { setError("请选择至少一个平台"); return; }
    setStep3("loading"); setError(null);
    try {
      const res = await fetch("/api/social/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "generate", longTailKeywords: toUse, platforms, tone, language }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setContents(data.data.contents);
      setStep3Stats(data.data.stats);
      setStep3("complete");
    } catch (err) { setError(err instanceof Error ? err.message : "生成失败"); setStep3("idle"); }
  };

  const toggleCoreSelect = (id: string) => setSelectedCoreIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleLongTailSelect = (id: string) => setSelectedLongTailIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const togglePlatform = (p: string) => setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const setPlatformForKeyword = (keyword: string, platformId: string) => {
    setActivePlatformByKeyword(prev => ({ ...prev, [keyword]: platformId }));
  };

  const getActiveContent = (keyword: string): GeneratedContent | undefined => {
    const platform = activePlatformByKeyword[keyword] || platforms[0];
    const kGroup = keywordGroups[keyword] || [];
    return kGroup.find(c => c.platform === platform) || kGroup[0];
  };

  const getImageUrl = (prompt: string) => {
    const cleanPrompt = prompt.slice(0, 200).replace(/[^\w\s,.-]/g, "");
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1024&height=1024&nologo=true`;
  };

  // 调用 DashScope 生成配图
  const handleGenerateImage = async (keyword: string, prompt: string) => {
    setGeneratingImages(prev => ({ ...prev, [keyword]: true }));
    try {
      const res = await fetch("/api/social/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.success && data.imageUrl) {
        setGeneratedImages(prev => ({ ...prev, [keyword]: data.imageUrl }));
      } else {
        alert(data.error || "生成失败");
      }
    } catch {
      alert("配图生成失败，请重试");
    } finally {
      setGeneratingImages(prev => ({ ...prev, [keyword]: false }));
    }
  };

  return (
    <div className="space-y-8">
      {/* 标题 + 步骤指示器 */}
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2"><Sparkles className="w-6 h-6 text-primary" />AI 关键词内容工坊</h2>
        <p className="text-muted-foreground mt-1">三步法：提取关键词 → 裂变长尾词 → 批量生成多平台社媒内容</p>
        <div className="flex items-center gap-2 mt-6 flex-wrap">
          {[1, 2, 3].map((n) => {
            const state = n === 1 ? step1 : n === 2 ? step2 : step3;
            return (
              <div key={n} className="flex items-center gap-2">
                <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${n === activeStep ? "bg-primary text-primary-foreground" : state === "complete" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-muted-foreground"}`}>
                  {state === "complete" ? <CheckCircle2 className="w-4 h-4" /> : <span className="w-5 h-5 rounded-full border-2 border-current flex items-center justify-center text-xs">{n}</span>}
                  <span>{n === 1 ? "提取核心词" : n === 2 ? "裂变长尾词" : "生成多平台内容"}</span>
                </div>
                {n < 3 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              </div>
            );
          })}
        </div>
      </div>

      {error && <Card className="border-destructive"><CardContent className="flex items-center gap-2 py-4 text-destructive"><AlertCircle className="w-5 h-5" /><span>{error}</span></CardContent></Card>}

      {/* ===== 步骤 1 ===== */}
      <Card className={activeStep === 1 ? "ring-2 ring-primary/20" : ""}>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">1</span>从知识库提取核心关键词</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2"><Label>关键词数量</Label><Input type="number" value={maxCoreKeywords} onChange={e => setMaxCoreKeywords(Number(e.target.value))} min={10} max={50} /></div>
            <div className="space-y-2"><Label>内容语言</Label><Select value={language} onValueChange={setLanguage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="max-h-[240px]">{SUPPORTED_LANGUAGES.map(l => <SelectItem key={l.code} value={l.code}>{l.nativeName} ({l.name})</SelectItem>)}</SelectContent></Select></div>
            <div className="flex items-end"><Button onClick={handleStep1} disabled={step1 === "loading"} className="w-full gap-2">{step1 === "loading" ? <><Loader2 className="w-4 h-4 animate-spin" />提取中...</> : <><Sparkles className="w-4 h-4" />提取核心关键词</>}</Button></div>
          </div>
          {step1 === "complete" && <StatsBar total={step1Stats.total} avgVol={step1Stats.avgVol} highValue={step1Stats.highValue} labels={["核心关键词", "平均搜索量", "高价值关键词"]} />}
          {coreKeywords.length > 0 && <KeywordList keywords={coreKeywords} selected={selectedCoreIds} onToggle={toggleCoreSelect} idPrefix="core" maxShow={15} />}
        </CardContent>
      </Card>

      {/* ===== 步骤 2 ===== */}
      <Card className={activeStep === 2 ? "ring-2 ring-primary/20" : step1 !== "complete" ? "opacity-60" : ""}>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">2</span>根据核心词裂变长尾关键词</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="space-y-2 w-40"><Label>每个词裂变数</Label><Input type="number" value={maxPerCore} onChange={e => setMaxPerCore(Number(e.target.value))} min={3} max={20} /></div>
            <Button onClick={handleStep2} disabled={step1 !== "complete" || step2 === "loading"} className="gap-2">{step2 === "loading" ? <><Loader2 className="w-4 h-4 animate-spin" />裂变中...</> : <><TrendingUp className="w-4 h-4" />裂变长尾关键词</>}</Button>
          </div>
          {step2 === "complete" && <StatsBar total={step2Stats.total} avgVol={step2Stats.avgVol} highValue={step2Stats.highValue} labels={["长尾关键词", "平均搜索量", "高价值关键词"]} />}
          {longTailKeywords.length > 0 && <KeywordList keywords={longTailKeywords} selected={selectedLongTailIds} onToggle={toggleLongTailSelect} idPrefix="lt" maxShow={30} />}
        </CardContent>
      </Card>

      {/* ===== 步骤 3 ===== */}
      <Card className={activeStep === 3 ? "ring-2 ring-primary/20" : step2 !== "complete" ? "opacity-60" : ""}>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">3</span>生成多平台社媒内容</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>目标平台</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_PLATFORMS.map(p => (
                  <Badge key={p.id} variant={platforms.includes(p.id) ? "default" : "outline"} className="cursor-pointer capitalize" onClick={() => togglePlatform(p.id)}>{p.name}</Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>语气风格</Label>
              <select value={tone} onChange={e => setTone(e.target.value)} className="rounded-md border px-3 py-2 text-sm"><option value="professional">专业权威</option><option value="casual">轻松友好</option><option value="humorous">幽默风趣</option><option value="informative">教育性</option></select>
            </div>
            <Button onClick={handleStep3} disabled={step2 !== "complete" || step3 === "loading"} className="gap-2">{step3 === "loading" ? <><Loader2 className="w-4 h-4 animate-spin" />生成中...</> : <><FileText className="w-4 h-4" />生成多平台内容</>}</Button>
          </div>
          {step3 === "complete" && (
            <div className="flex items-center gap-4 mt-2">
              <Badge variant="default"><CheckCircle2 className="w-3 h-3 mr-1" />{keywordList.length} 个关键词</Badge>
              <Badge variant="secondary">{step3Stats.success} 条内容 × {platforms.length} 平台</Badge>
            </div>
          )}

          {/* 内容卡片：左侧平台切换器 + 右侧内容 */}
          {keywordList.length > 0 && (
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {keywordList.map((kw) => {
                const kGroup = keywordGroups[kw] || [];
                const activeContent = getActiveContent(kw);
                const currentPlatform = activePlatformByKeyword[kw] || platforms[0];
                return (
                  <Card key={kw} className="overflow-hidden border">
                    <div className="flex">
                      {/* 左侧平台切换器 */}
                      <div className="flex flex-col gap-1 p-3 border-r bg-muted/30 shrink-0">
                        {ALL_PLATFORMS.filter(p => platforms.includes(p.id)).map(p => (
                          <button
                            key={p.id}
                            onClick={() => setPlatformForKeyword(kw, p.id)}
                            className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm transition-all ${
                              currentPlatform === p.id
                                ? `${p.color} text-white ring-2 ${p.ringColor} ring-offset-1 scale-110`
                                : "bg-muted hover:bg-accent text-muted-foreground hover:text-foreground"
                            }`}
                            title={`${p.name} 版本`}
                          >
                            <span className="text-base leading-none">{p.icon}</span>
                          </button>
                        ))}
                      </div>

                      {/* 右侧内容 */}
                      <div className="flex-1 min-w-0">
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge>{kw}</Badge>
                              <Badge variant="outline" className="capitalize">{ALL_PLATFORMS.find(p => p.id === currentPlatform)?.name || currentPlatform}</Badge>
                              <span className="text-xs text-muted-foreground">{activeContent?.metadata.searchIntent}</span>
                            </div>
                            <Badge variant="outline">~{activeContent?.metadata.estimatedReadTime || 0}s</Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-0">
                          <Textarea value={activeContent?.text || ""} readOnly className="min-h-[80px] resize-none text-sm" />
                          {activeContent?.hashtags && activeContent.hashtags.length > 0 && (
                            <div className="flex flex-wrap gap-1">{activeContent.hashtags.map((t, j) => <Badge key={j} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>
                          )}
                          {activeContent?.cta && <div className="p-2 bg-blue-50 rounded text-xs text-blue-700"><b>CTA:</b> {activeContent.cta}</div>}

                          {/* 审核 + 发布按钮 */}
                          <div className="flex items-center gap-2 pt-1 border-t">
                            {(() => {
                              const key = itemKey(kw, currentPlatform);
                              const isApproved = approvedItems[key];
                              const isPublished = publishedItems[key];
                              const isPublishing = publishingItems[key];

                              if (isPublished) {
                                return <Badge className="gap-1 bg-emerald-100 text-emerald-700"><CheckCircle2 className="w-3 h-3" />已发布</Badge>;
                              }

                              return (
                                <>
                                  <Button
                                    size="sm"
                                    variant={isApproved ? "default" : "outline"}
                                    className={`h-8 text-xs gap-1 ${isApproved ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                                    onClick={() => setApprovedItems(prev => ({ ...prev, [key]: !prev[key] }))}
                                  >
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    {isApproved ? "已审核" : "审核通过"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="h-8 text-xs gap-1"
                                    disabled={!isApproved || isPublishing}
                                    onClick={() => activeContent && handlePublish(activeContent)}
                                  >
                                    {isPublishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                    {isPublishing ? "发布中..." : `发布到 ${ALL_PLATFORMS.find(p => p.id === currentPlatform)?.name || currentPlatform}`}
                                  </Button>
                                </>
                              );
                            })()}
                          </div>
                          {activeContent?.imagePrompt && (
                            <div className="rounded-lg border border-purple-100 overflow-hidden">
                              <div className="bg-gradient-to-r from-purple-50 to-pink-50 px-3 py-2 flex items-center gap-2">
                                <ImageIcon className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                                <span className="text-xs text-purple-700 truncate flex-1">{activeContent.imagePrompt.slice(0, 80)}...</span>
                                <div className="flex gap-1 shrink-0">
                                  <Button size="sm" variant="ghost" className="h-7 text-[10px] text-purple-600" onClick={() => { navigator.clipboard.writeText(activeContent.imagePrompt!); alert("已复制！"); }}><Copy className="w-3 h-3" /></Button>
                                  <Button size="sm" variant="ghost" className="h-7 text-[10px] text-purple-600" onClick={() => window.open(getImageUrl(activeContent.imagePrompt!), "_blank")}><ExternalLink className="w-3 h-3 mr-1" />AI 生图</Button>
                                </div>
                              </div>
                              {generatedImages[kw] && (
                                <img src={generatedImages[kw]!} alt={kw} className="w-full h-48 object-cover" loading="lazy" />
                              )}
                            </div>
                          )}
                        </CardContent>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ===== 复用小组件 =====

function StatsBar({ total, avgVol, highValue, labels }: { total: number; avgVol: number; highValue: number; labels: string[] }) {
  return (
    <div className="grid grid-cols-3 gap-3 mt-4">
      <div className="bg-muted/50 rounded-lg p-3 text-center"><div className="text-2xl font-bold">{total}</div><div className="text-xs text-muted-foreground">{labels[0]}</div></div>
      <div className="bg-muted/50 rounded-lg p-3 text-center"><div className="text-2xl font-bold">{avgVol.toLocaleString()}</div><div className="text-xs text-muted-foreground">{labels[1]}</div></div>
      <div className="bg-muted/50 rounded-lg p-3 text-center"><div className="text-2xl font-bold text-green-600">{highValue}</div><div className="text-xs text-muted-foreground">{labels[2]}</div></div>
    </div>
  );
}

function KeywordList({ keywords, selected, onToggle, idPrefix, maxShow }: { keywords: any[]; selected: string[]; onToggle: (id: string) => void; idPrefix: string; maxShow: number }) {
  return (
    <div className="space-y-1 max-h-[200px] overflow-y-auto border rounded-lg p-2">
      {keywords.slice(0, maxShow).map(kw => (
        <div key={kw.id} className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-accent">
          <Checkbox checked={selected.includes(kw.id)} onCheckedChange={() => onToggle(kw.id)} id={`${idPrefix}-${kw.id}`} />
          <label htmlFor={`${idPrefix}-${kw.id}`} className="flex-1 cursor-pointer truncate">{kw.term}</label>
          <Badge variant="secondary" className="text-[10px]">{kw.category}</Badge>
          <span className="text-[10px] text-muted-foreground">{kw.metrics.searchVolume.toLocaleString()}</span>
        </div>
      ))}
      {selected.length > 0 && <p className="text-xs text-muted-foreground px-2 pt-1">已选 {selected.length} 个</p>}
    </div>
  );
}

function calcAvg(keywords: any[]): number {
  if (keywords.length === 0) return 0;
  return Math.round(keywords.reduce((s: number, k: any) => s + (k.metrics?.searchVolume || 0), 0) / keywords.length);
}
