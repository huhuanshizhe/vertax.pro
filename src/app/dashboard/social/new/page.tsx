"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, Send, Save } from "lucide-react";
import { generateAIContent, createSocialPost, publishSocialPost, scheduleSocialPost } from "@/actions/social";
import { toast } from "sonner";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "@/lib/languages";

export default function NewSocialPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form state
  const [title, setTitle] = useState("");
  const [platforms, setPlatforms] = useState<Record<string, boolean>>({
    x: true,
    facebook: true,
  });
  const [xContent, setXContent] = useState("");
  const [fbContent, setFbContent] = useState("");
  const [scheduleType, setScheduleType] = useState("now");
  const [scheduledTime, setScheduledTime] = useState("");
  const [autoEngage, setAutoEngage] = useState(false);

  // AI generation state
  const [aiTopic, setAiTopic] = useState("");
  const [aiContext, setAiContext] = useState("");
  const [aiTone, setAiTone] = useState("professional");
  const [aiLanguage, setAiLanguage] = useState(DEFAULT_LANGUAGE);
  const [generating, setGenerating] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);

  function togglePlatform(key: string) {
    setPlatforms((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const selectedPlatforms = Object.entries(platforms)
    .filter(([, v]) => v)
    .map(([k]) => k);

  async function handleAIGenerate() {
    if (!aiTopic.trim()) {
      toast.error("请输入主题");
      return;
    }
    if (selectedPlatforms.length === 0) {
      toast.error("请至少选择一个平台");
      return;
    }

    setGenerating(true);
    try {
      const result = await generateAIContent({
        topic: aiTopic,
        context: aiContext || undefined,
        tone: aiTone,
        platforms: selectedPlatforms,
        language: aiLanguage,
      });

      if (result.x) setXContent(result.x);
      if (result.facebook) setFbContent(result.facebook);
      toast.success("AI 内容已生成！");
    } catch {
      toast.error("AI 生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  }

  function buildVersions() {
    const versions: { platform: string; content: string }[] = [];
    if (platforms.x && xContent.trim()) {
      versions.push({ platform: "x", content: xContent });
    }
    if (platforms.facebook && fbContent.trim()) {
      versions.push({ platform: "facebook", content: fbContent });
    }
    return versions;
  }

  function handleSaveDraft() {
    const versions = buildVersions();
    if (versions.length === 0) {
      toast.error("请至少输入一个平台的内容");
      return;
    }

    startTransition(async () => {
      try {
        await createSocialPost({
          title: title || undefined,
          status: "draft",
          autoEngage,
          versions,
        });
        toast.success("草稿已保存");
        router.push("/zh-CN/social");
      } catch {
        toast.error("保存失败");
      }
    });
  }

  function handlePublishNow() {
    const versions = buildVersions();
    if (versions.length === 0) {
      toast.error("请至少输入一个平台的内容");
      return;
    }

    startTransition(async () => {
      try {
        const post = await createSocialPost({
          title: title || undefined,
          status: "draft",
          autoEngage,
          versions,
        });
        if (post && typeof post === "object" && "id" in post) {
          const result = await publishSocialPost(post.id as string);
          if (result.success) {
            toast.success("发布成功！");
          } else {
            const errors = result.results.filter((r) => !r.success).map((r) => `${r.platform}: ${r.error}`);
            toast.warning(`部分发布失败: ${errors.join("; ")}`);
          }
        }
        router.push("/zh-CN/social");
      } catch {
        toast.error("发布失败");
      }
    });
  }

  function handleSchedule() {
    if (!scheduledTime) {
      toast.error("请选择发布时间");
      return;
    }
    const versions = buildVersions();
    if (versions.length === 0) {
      toast.error("请至少输入一个平台的内容");
      return;
    }

    startTransition(async () => {
      try {
        const post = await createSocialPost({
          title: title || undefined,
          status: "draft",
          scheduledAt: new Date(scheduledTime),
          autoEngage,
          versions,
        });
        if (post && typeof post === "object" && "id" in post) {
          await scheduleSocialPost(post.id as string, new Date(scheduledTime));
        }
        toast.success("已排期发布");
        router.push("/zh-CN/social");
      } catch {
        toast.error("排期失败");
      }
    });
  }

  return (
    <div className="container mx-auto p-6">
      <PageHeader title="新建社媒发布" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>发布设置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title">标题（内部引用）</Label>
                <Input
                  id="title"
                  placeholder="输入内部标题"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              {/* Platform Selection */}
              <div className="space-y-2">
                <Label>选择平台</Label>
                <div className="flex flex-wrap gap-4">
                  {[
                    { key: "x", label: "X (Twitter)" },
                    { key: "facebook", label: "Facebook" },
                  ].map((p) => (
                    <div key={p.key} className="flex items-center space-x-2">
                      <Checkbox
                        id={`platform-${p.key}`}
                        checked={platforms[p.key] || false}
                        onCheckedChange={() => togglePlatform(p.key)}
                      />
                      <label htmlFor={`platform-${p.key}`} className="text-sm font-medium">
                        {p.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Content Tabs */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>发布内容</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAiPanel(!showAiPanel)}
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    AI 生成
                  </Button>
                </div>
                <Tabs defaultValue="x" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="x" disabled={!platforms.x}>X</TabsTrigger>
                    <TabsTrigger value="facebook" disabled={!platforms.facebook}>Facebook</TabsTrigger>
                  </TabsList>
                  <TabsContent value="x" className="space-y-2">
                    <Textarea
                      placeholder="输入 X (Twitter) 内容..."
                      rows={6}
                      value={xContent}
                      onChange={(e) => setXContent(e.target.value)}
                    />
                    <p className={`text-sm text-right ${xContent.length > 280 ? "text-destructive" : "text-muted-foreground"}`}>
                      {xContent.length} / 280 字符
                    </p>
                  </TabsContent>
                  <TabsContent value="facebook" className="space-y-2">
                    <Textarea
                      placeholder="输入 Facebook 内容..."
                      rows={6}
                      value={fbContent}
                      onChange={(e) => setFbContent(e.target.value)}
                    />
                    <p className="text-sm text-muted-foreground text-right">
                      {fbContent.length} 字符
                    </p>
                  </TabsContent>
                </Tabs>
              </div>

              {/* Media Upload */}
              <div className="space-y-2">
                <Label>媒体上传</Label>
                <div className="border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground">
                  点击或拖拽上传图片/视频
                </div>
              </div>

              {/* Schedule */}
              <div className="space-y-2">
                <Label>发布时间</Label>
                <RadioGroup value={scheduleType} onValueChange={setScheduleType}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="now" id="now" />
                    <label htmlFor="now" className="text-sm font-medium">立即发布</label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="scheduled" id="scheduled" />
                    <label htmlFor="scheduled" className="text-sm font-medium">定时发布</label>
                  </div>
                </RadioGroup>
                {scheduleType === "scheduled" && (
                  <Input
                    type="datetime-local"
                    className="mt-2"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                  />
                )}
              </div>

              {/* Auto-engage */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-engage">自动互动</Label>
                  <p className="text-sm text-muted-foreground">自动点赞和回复相关评论</p>
                </div>
                <Switch
                  id="auto-engage"
                  checked={autoEngage}
                  onCheckedChange={setAutoEngage}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-4">
                <Button variant="outline" onClick={handleSaveDraft} disabled={isPending}>
                  <Save className="mr-2 h-4 w-4" />
                  保存草稿
                </Button>
                {scheduleType === "scheduled" ? (
                  <Button onClick={handleSchedule} disabled={isPending}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    排期发布
                  </Button>
                ) : (
                  <Button onClick={handlePublishNow} disabled={isPending}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    立即发布
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* AI Generation Panel */}
        <div className={showAiPanel ? "" : "hidden lg:block"}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                AI 内容生成
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>主题 / 产品</Label>
                <Input
                  placeholder="例：工业水泵产品推广"
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>补充说明（可选）</Label>
                <Textarea
                  placeholder="目标客户、卖点、促销信息等..."
                  rows={3}
                  value={aiContext}
                  onChange={(e) => setAiContext(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>语气风格</Label>
                <Select value={aiTone} onValueChange={setAiTone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">专业正式</SelectItem>
                    <SelectItem value="casual">轻松随意</SelectItem>
                    <SelectItem value="humorous">幽默风趣</SelectItem>
                    <SelectItem value="informative">知识科普</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>内容语言</Label>
                <Select value={aiLanguage} onValueChange={setAiLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.nativeName} ({lang.name})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                onClick={handleAIGenerate}
                disabled={generating}
              >
                {generating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {generating ? "生成中..." : "生成内容"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                AI 将根据所选平台自动生成适配内容
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
