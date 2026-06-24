/**
 * 关键词驱动的社媒内容生成器组件
 * 
 * 功能:
 * 1. 展示挖掘出的核心关键词和长尾词
 * 2. 允许用户选择要生成内容的关键词
 * 3. 批量生成社媒内容
 * 4. 展示生成的内容和配图建议
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Sparkles,
  TrendingUp,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

// ==================== 类型定义 ====================

type KeywordMetric = {
  searchVolume: number;
  competition: "low" | "medium" | "high";
  commercialIntent: number;
  relevance: number;
};

type CoreKeyword = {
  id: string;
  term: string;
  category: string;
  metrics: KeywordMetric;
  confidence: number;
};

type LongTailKeyword = {
  id: string;
  coreKeywordId: string;
  term: string;
  category: string;
  metrics: KeywordMetric;
  contentAngle?: string;
  searchIntent?: string;
};

type GeneratedContent = {
  text: string;
  hashtags: string[];
  cta?: string;
  imagePrompt?: string;
  imageUrl?: string;
  metadata: {
    keywordUsed: string;
    searchIntent: string;
    contentAngle: string;
    estimatedReadTime: number;
  };
};

type GenerationResult = {
  keywords: {
    core: CoreKeyword[];
    longTail: LongTailKeyword[];
    stats: {
      totalCoreKeywords: number;
      totalLongTailKeywords: number;
      avgSearchVolume: number;
      highValueKeywords: number;
    };
  };
  contents: GeneratedContent[];
  stats: {
    totalGenerated: number;
    successCount: number;
    failedCount: number;
    avgLength: number;
  };
};

// ==================== 主组件 ====================

export default function KeywordDrivenContentGenerator() {
  // 状态管理
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState<
    "idle" | "extracting" | "expanding" | "generating" | "complete"
  >("idle");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 配置选项
  const [config, setConfig] = useState({
    maxCoreKeywords: 30,
    maxLongTailPerCore: 10,
    minSearchVolume: 50,
    platforms: ["linkedin", "x"] as string[],
    tone: "professional" as string,
    language: "zh-CN",
    targetRegion: "",
    targetIndustries: [] as string[],
  });

  // 选中的关键词
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);

  // 生成内容
  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationStep("extracting");
    setError(null);

    try {
      const response = await fetch("/api/social/generate-from-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "生成失败");
      }

      setResult(data.data);
      setGenerationStep("complete");
    } catch (err) {
      console.error("[KeywordDrivenContentGenerator] Error:", err);
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setIsGenerating(false);
    }
  };

  // 切换平台选择
  const togglePlatform = (platform: string) => {
    setConfig((prev) => ({
      ...prev,
      platforms: prev.platforms.includes(platform)
        ? prev.platforms.filter((p) => p !== platform)
        : [...prev.platforms, platform],
    }));
  };

  // 切换关键词选择
  const toggleKeywordSelection = (keywordId: string) => {
    setSelectedKeywords((prev) =>
      prev.includes(keywordId)
        ? prev.filter((id) => id !== keywordId)
        : [...prev, keywordId]
    );
  };

  return (
    <div className="space-y-6">
      {/* 标题区域 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            AI 驱动的社媒内容生成器
          </h2>
          <p className="text-muted-foreground mt-1">
            从知识库提炼关键词 → 裂变长尾词 → 批量生成高质量社媒内容
          </p>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || config.platforms.length === 0}
          size="lg"
          className="gap-2"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              开始生成
            </>
          )}
        </Button>
      </div>

      {/* 错误提示 */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 py-4 text-destructive">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      {/* 配置面板 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">生成配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 目标平台 */}
          <div className="space-y-2">
            <Label>目标平台</Label>
            <div className="flex flex-wrap gap-2">
              {["linkedin", "x", "facebook", "instagram", "tiktok", "wechat"].map(
                (platform) => (
                  <Badge
                    key={platform}
                    variant={config.platforms.includes(platform) ? "default" : "outline"}
                    className="cursor-pointer capitalize"
                    onClick={() => togglePlatform(platform)}
                  >
                    {platform}
                  </Badge>
                )
              )}
            </div>
          </div>

          {/* 语气风格 */}
          <div className="space-y-2">
            <Label>语气风格</Label>
            <select
              value={config.tone}
              onChange={(e) => setConfig({ ...config, tone: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="professional">专业权威</option>
              <option value="casual">轻松友好</option>
              <option value="humorous">幽默风趣</option>
              <option value="informative">教育性</option>
              <option value="inspirational">激励性</option>
            </select>
          </div>

          {/* 高级选项 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>核心词数量</Label>
              <Input
                type="number"
                value={config.maxCoreKeywords}
                onChange={(e) =>
                  setConfig({ ...config, maxCoreKeywords: Number(e.target.value) })
                }
                min={10}
                max={50}
              />
            </div>
            <div className="space-y-2">
              <Label>每个核心词裂变的长尾词数</Label>
              <Input
                type="number"
                value={config.maxLongTailPerCore}
                onChange={(e) =>
                  setConfig({ ...config, maxLongTailPerCore: Number(e.target.value) })
                }
                min={5}
                max={20}
              />
            </div>
            <div className="space-y-2">
              <Label>最小搜索量</Label>
              <Input
                type="number"
                value={config.minSearchVolume}
                onChange={(e) =>
                  setConfig({ ...config, minSearchVolume: Number(e.target.value) })
                }
                min={10}
                max={1000}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 生成进度 */}
      {isGenerating && (
        <Card>
          <CardContent className="py-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="font-medium">
                  {generationStep === "extracting" && "正在从知识库提取核心关键词..."}
                  {generationStep === "expanding" && "正在裂变长尾关键词..."}
                  {generationStep === "generating" && "正在生成社媒内容..."}
                  {generationStep === "complete" && "生成完成!"}
                </span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-500"
                  style={{
                    width:
                      generationStep === "extracting"
                        ? "25%"
                        : generationStep === "expanding"
                        ? "50%"
                        : generationStep === "generating"
                        ? "75%"
                        : "100%",
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 结果展示 */}
      {result && !isGenerating && (
        <Tabs defaultValue="keywords" className="space-y-4">
          <TabsList>
            <TabsTrigger value="keywords">
              <TrendingUp className="w-4 h-4 mr-2" />
              关键词 ({result.keywords.stats.totalLongTailKeywords})
            </TabsTrigger>
            <TabsTrigger value="contents">
              <FileText className="w-4 h-4 mr-2" />
              生成内容 ({result.stats.successCount})
            </TabsTrigger>
          </TabsList>

          {/* 关键词标签页 */}
          <TabsContent value="keywords" className="space-y-4">
            {/* 统计卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="py-4">
                  <div className="text-sm text-muted-foreground">核心关键词</div>
                  <div className="text-2xl font-bold">
                    {result.keywords.stats.totalCoreKeywords}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <div className="text-sm text-muted-foreground">长尾关键词</div>
                  <div className="text-2xl font-bold">
                    {result.keywords.stats.totalLongTailKeywords}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <div className="text-sm text-muted-foreground">平均搜索量</div>
                  <div className="text-2xl font-bold">
                    {result.keywords.stats.avgSearchVolume.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <div className="text-sm text-muted-foreground">高价值关键词</div>
                  <div className="text-2xl font-bold text-green-600">
                    {result.keywords.stats.highValueKeywords}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 核心关键词列表 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">核心关键词</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.keywords.core.slice(0, 10).map((kw) => (
                  <div
                    key={kw.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{kw.term}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        <Badge variant="secondary" className="mr-2">
                          {kw.category}
                        </Badge>
                        搜索量: {kw.metrics.searchVolume.toLocaleString()} | 竞争:{" "}
                        {kw.metrics.competition === "low"
                          ? "低"
                          : kw.metrics.competition === "medium"
                          ? "中"
                          : "高"}
                      </div>
                    </div>
                    <Badge variant="outline">{Math.round(kw.confidence * 100)}%</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* 长尾关键词列表 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">长尾关键词</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.keywords.longTail.slice(0, 20).map((kw) => (
                  <div
                    key={kw.id}
                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                  >
                    <Checkbox
                      checked={selectedKeywords.includes(kw.id)}
                      onCheckedChange={() => toggleKeywordSelection(kw.id)}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{kw.term}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {kw.contentAngle && (
                          <div className="text-blue-600">{kw.contentAngle}</div>
                        )}
                        <div className="flex gap-2 mt-1">
                          <Badge variant="secondary">{kw.category}</Badge>
                          <Badge variant="outline">
                            搜索量: {kw.metrics.searchVolume.toLocaleString()}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 生成内容标签页 */}
          <TabsContent value="contents" className="space-y-4">
            {/* 统计信息 */}
            <div className="flex items-center gap-4">
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="w-3 h-3" />
                成功: {result.stats.successCount}
              </Badge>
              {result.stats.failedCount > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="w-3 h-3" />
                  失败: {result.stats.failedCount}
                </Badge>
              )}
              <Badge variant="secondary">
                平均长度: {result.stats.avgLength} 字
              </Badge>
            </div>

            {/* 内容卡片 */}
            <div className="grid grid-cols-1 gap-4">
              {result.contents.map((content, index) => (
                <Card key={index} className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Badge>{content.metadata.keywordUsed}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {content.metadata.searchIntent}
                        </span>
                      </CardTitle>
                      <Badge variant="outline">
                        ~{content.metadata.estimatedReadTime}秒阅读
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 文案内容 */}
                    <Textarea
                      value={content.text}
                      readOnly
                      className="min-h-[120px] resize-none"
                    />

                    {/* Hashtags */}
                    {content.hashtags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {content.hashtags.map((tag, i) => (
                          <Badge key={i} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* CTA */}
                    {content.cta && (
                      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="text-sm font-medium text-blue-900">
                          行动号召 (CTA)
                        </div>
                        <div className="text-sm text-blue-700 mt-1">{content.cta}</div>
                      </div>
                    )}

                    {/* 配图建议 */}
                    {content.imagePrompt && (
                      <div className="flex items-start gap-2 p-3 bg-accent/50 rounded-lg">
                        <ImageIcon className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div className="flex-1">
                          <div className="text-sm font-medium">配图建议</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {content.imagePrompt}
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
