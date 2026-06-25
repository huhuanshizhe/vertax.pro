"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "@/lib/languages";
import { Loader2, Sparkles, Link2, Search, Lightbulb, ListChecks, PenTool, CheckCircle2, AlertCircle, ChevronRight, ShieldCheck, Send, Globe } from "lucide-react";

type StepState = "idle" | "loading" | "complete";

const PLATFORMS = [
  { id: "linkedin", name: "LinkedIn", icon: "🔗", color: "bg-blue-700", desc: "专业分析" },
  { id: "facebook", name: "Facebook", icon: "📘", color: "bg-blue-600", desc: "行业分享" },
  { id: "x", name: "X", icon: "𝕏", color: "bg-slate-800", desc: "短观点" },
  { id: "instagram", name: "Instagram", icon: "📷", color: "bg-pink-600", desc: "图文文案" },
  { id: "tiktok", name: "TikTok", icon: "🎵", color: "bg-neutral-950", desc: "视频脚本" },
  { id: "pinterest", name: "Pinterest", icon: "📌", color: "bg-red-700", desc: "教程内容" },
];

export default function ProductContentGenerator() {
  const [step, setStep] = useState<StepState>("idle");
  const [activeStep, setActiveStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [productUrl, setProductUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [parsedContent, setParsedContent] = useState("");
  const [analysis, setAnalysis] = useState<{ keywords: string[]; userNeeds: string[]; scenarios: string[]; painPoints: string[] } | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [contents, setContents] = useState<Record<string, Record<string, any>>>({});
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);

  // Review & publish
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [publishing, setPublishing] = useState<Record<string, boolean>>({});
  const [published, setPublished] = useState<Record<string, boolean>>({});
  const [activePlatform, setActivePlatform] = useState("linkedin");

  // Load saved
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/social/product-pipeline");
        const data = await res.json();
        const p = data?.data;
        if (!p) return;
        if (p.productName) { setProductName(p.productName); setProductUrl(p.productUrl || ""); setParsedContent(p.parsedContent || ""); }
        if (p.analysis) { setAnalysis(p.analysis); setActiveStep(3); }
        if (p.topics?.length) { setTopics(p.topics); setActiveStep(4); }
        if (p.contents && Object.keys(p.contents).length > 0) { setContents(p.contents); }
      } catch {}
    })();
  }, []);

  const callPipeline = async (stepName: string, extra: any = {}) => {
    setError(null);
    const res = await fetch("/api/social/product-pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: stepName, productUrl, productName, parsedContent, analysis, topics, language, ...extra }),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || "Failed");
    return d.data;
  };

  // Step 1: Parse
  const handleParse = async () => {
    if (!productUrl.trim()) { setError("请输入产品链接"); return; }
    setStep("loading");
    try {
      const d = await callPipeline("parse");
      setProductName(d.productName);
      setParsedContent(d.parsedContent);
      setStep("complete"); setActiveStep(2);
    } catch (e) { setError((e as Error).message); setStep("idle"); }
  };

  // Step 2: Analyze
  const handleAnalyze = async () => {
    setStep("loading");
    try {
      const d = await callPipeline("analyze");
      setAnalysis(d.analysis);
      setStep("complete"); setActiveStep(3);
    } catch (e) { setError((e as Error).message); setStep("idle"); }
  };

  // Step 3: Topics
  const handleTopics = async () => {
    setStep("loading");
    try {
      const d = await callPipeline("topics");
      setTopics(d.topics);
      setStep("complete"); setActiveStep(4);
    } catch (e) { setError((e as Error).message); setStep("idle"); }
  };

  // Step 4: Rewrite
  const handleRewrite = async () => {
    const toUse = selectedTopics.length > 0 ? selectedTopics : topics.slice(0, 10);
    setStep("loading");
    try {
      const d = await callPipeline("rewrite", { topics: toUse });
      setContents(d.contents);
      setStep("complete");
    } catch (e) { setError((e as Error).message); setStep("idle"); }
  };

  // Publish single
  const handlePublish = async (topic: string, platform: string, text: string) => {
    const key = `${topic}|${platform}`;
    if (!approved[key]) { alert("请先审核通过"); return; }
    setPublishing(p => ({ ...p, [key]: true }));
    try {
      const r = await fetch("/api/social/publish-single", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform, content: text, keyword: topic }) });
      const d = await r.json();
      if (d.success) { setPublished(p => ({ ...p, [key]: true })); alert(`已发布到 ${platform}！`); }
      else alert(d.error);
    } catch { alert("发布失败"); }
    finally { setPublishing(p => ({ ...p, [key]: false })); }
  };

  const contentKeys = useMemo(() => Object.keys(contents), [contents]);
  const currentTopic = contentKeys[0] || "";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2"><Sparkles className="w-6 h-6 text-primary" />产品内容引擎</h2>
        <p className="text-muted-foreground mt-1">产品链接 → AI分析 → 主题池 → 六平台改写 → 审核发布</p>
        <div className="flex items-center gap-2 mt-6 flex-wrap">
          {["解析产品", "AI分析", "主题池", "改写+发布"].map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${i + 1 === activeStep ? "bg-primary text-primary-foreground" : i + 1 < activeStep ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-muted-foreground"}`}>
                {i + 1 < activeStep ? <CheckCircle2 className="w-4 h-4" /> : <span className="w-5 h-5 rounded-full border-2 border-current flex items-center justify-center text-xs">{i + 1}</span>}
                <span>{label}</span>
              </div>
              {i < 3 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </div>

      {error && <Card className="border-destructive"><CardContent className="flex items-center gap-2 py-4 text-destructive"><AlertCircle className="w-5 h-5" /><span>{error}</span></CardContent></Card>}

      {/* Step 1: Product URL */}
      <Card className={activeStep === 1 ? "ring-2 ring-primary/20" : ""}>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">1</span>抓取产品链接</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Label>产品页面链接</Label>
              <Input placeholder="https://example.com/product/..." value={productUrl} onChange={e => setProductUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && handleParse()} />
            </div>
            <div className="space-y-2">
              <Label>语言</Label>
              <Select value={language} onValueChange={setLanguage}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_LANGUAGES.map(l => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="flex items-end"><Button onClick={handleParse} disabled={step === "loading"} className="gap-2">{step === "loading" ? <><Loader2 className="w-4 h-4 animate-spin" />解析中</> : <><Link2 className="w-4 h-4" />解析链接</>}</Button></div>
          </div>
          {productName && <div className="p-3 bg-muted/50 rounded-lg"><span className="text-sm font-medium">{productName}</span><span className="text-xs text-muted-foreground ml-2">{parsedContent.length} 字符</span></div>}
        </CardContent>
      </Card>

      {/* Step 2: AI Analysis */}
      <Card className={activeStep >= 2 ? (activeStep === 2 ? "ring-2 ring-primary/20" : "") : "opacity-60"}>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">2</span>AI 分析产品</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleAnalyze} disabled={!productName || step === "loading"} className="gap-2">{step === "loading" ? <><Loader2 className="w-4 h-4 animate-spin" />分析中...</> : <><Search className="w-4 h-4" />开始 AI 分析</>}</Button>
          {analysis && (
            <div className="grid grid-cols-2 gap-3">
              <ModuleCard icon="🔑" title="产品关键词" items={analysis.keywords} color="blue" />
              <ModuleCard icon="🎯" title="用户需求" items={analysis.userNeeds} color="emerald" />
              <ModuleCard icon="🏭" title="应用场景" items={analysis.scenarios} color="purple" />
              <ModuleCard icon="💡" title="行业痛点" items={analysis.painPoints} color="amber" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Topic Pool */}
      <Card className={activeStep >= 3 ? (activeStep === 3 ? "ring-2 ring-primary/20" : "") : "opacity-60"}>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">3</span>自动生成主题池</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleTopics} disabled={!analysis || step === "loading"} className="gap-2">{step === "loading" ? <><Loader2 className="w-4 h-4 animate-spin" />生成中...</> : <><Lightbulb className="w-4 h-4" />生成 {100}+ 主题</>}</Button>
          {topics.length > 0 && (
            <>
              <div className="flex items-center gap-2"><Badge variant="default">{topics.length} 个主题</Badge><span className="text-xs text-muted-foreground">已选 {selectedTopics.length} 个</span></div>
              <div className="max-h-[200px] overflow-y-auto border rounded-lg p-2 space-y-1">
                {topics.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-accent cursor-pointer" onClick={() => setSelectedTopics(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])}>
                    <input type="checkbox" checked={selectedTopics.includes(t)} onChange={() => {}} className="w-4 h-4" />
                    <span className="flex-1">{t}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Step 4: Rewrite & Review */}
      <Card className={activeStep >= 4 ? (activeStep === 4 ? "ring-2 ring-primary/20" : "") : "opacity-60"}>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">4</span>六平台改写 & 审核发布</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleRewrite} disabled={!topics.length || step === "loading"} className="gap-2">{step === "loading" ? <><Loader2 className="w-4 h-4 animate-spin" />改写中...</> : <><PenTool className="w-4 h-4" />六平台改写</>}</Button>

          {contentKeys.length > 0 && (
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {contentKeys.map(topic => {
                const tContents = contents[topic] || {};
                const active = tContents[activePlatform];
                return (
                  <Card key={topic} className="overflow-hidden border">
                    <div className="flex">
                      {/* Platform switcher */}
                      <div className="flex flex-col gap-1 p-3 border-r bg-muted/30 shrink-0">
                        {PLATFORMS.map(p => {
                          const hasContent = !!tContents[p.id];
                          return (
                            <button
                              key={p.id}
                              onClick={() => setActivePlatform(p.id)}
                              className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm transition-all ${activePlatform === p.id ? `${p.color} text-white ring-2 ring-offset-1 scale-110` : hasContent ? "bg-muted hover:bg-accent" : "opacity-30"}`}
                              title={`${p.name} - ${p.desc}`}
                            >
                              <span>{p.icon}</span>
                            </button>
                          );
                        })}
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">{topic}</span>
                              <Badge variant="outline" className="capitalize">{PLATFORMS.find(p => p.id === activePlatform)?.name}</Badge>
                              <span className="text-[10px] text-muted-foreground">{PLATFORMS.find(p => p.id === activePlatform)?.desc}</span>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-0">
                          {active ? (
                            <>
                              <Textarea value={active.text || ""} readOnly className="min-h-[80px] resize-none text-sm" />
                              {active.hashtags?.length > 0 && <div className="flex gap-1">{active.hashtags.map((t: string, j: number) => <Badge key={j} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>}
                              <div className="flex items-center gap-2 pt-1 border-t">
                                {(() => {
                                  const key = `${topic}|${activePlatform}`;
                                  if (published[key]) return <Badge className="gap-1 bg-emerald-100 text-emerald-700"><CheckCircle2 className="w-3 h-3" />已发布</Badge>;
                                  return (
                                    <>
                                      <Button size="sm" variant={approved[key] ? "default" : "outline"} className={`h-8 text-xs gap-1 ${approved[key] ? "bg-emerald-600 hover:bg-emerald-700" : ""}`} onClick={() => setApproved(p => ({ ...p, [key]: !p[key] }))}>
                                        <ShieldCheck className="w-3.5 h-3.5" />{approved[key] ? "已审核" : "审核通过"}
                                      </Button>
                                      <Button size="sm" className="h-8 text-xs gap-1" disabled={!approved[key] || publishing[key]} onClick={() => handlePublish(topic, activePlatform, active.text)}>
                                        {publishing[key] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                        {publishing[key] ? "发布中" : `发布到 ${PLATFORMS.find(p => p.id === activePlatform)?.name}`}
                                      </Button>
                                    </>
                                  );
                                })()}
                              </div>
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground py-4 text-center">该平台暂未生成内容</p>
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

function ModuleCard({ icon, title, items, color }: { icon: string; title: string; items: string[]; color: string }) {
  const colors: Record<string, string> = { blue: "border-blue-200 bg-blue-50", emerald: "border-emerald-200 bg-emerald-50", purple: "border-purple-200 bg-purple-50", amber: "border-amber-200 bg-amber-50" };
  return (
    <div className={`rounded-lg border p-3 ${colors[color] || colors.blue}`}>
      <div className="flex items-center gap-1 mb-2"><span className="text-lg">{icon}</span><span className="text-xs font-semibold">{title}</span></div>
      <div className="space-y-1">
        {items.slice(0, 5).map((item, i) => <div key={i} className="text-xs flex items-start gap-1"><span className="text-slate-400">•</span><span>{item}</span></div>)}
        {items.length > 5 && <div className="text-[10px] text-slate-400">+{items.length - 5} 更多</div>}
      </div>
    </div>
  );
}
