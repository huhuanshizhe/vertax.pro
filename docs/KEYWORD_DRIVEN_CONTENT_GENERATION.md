# 关键词驱动的社媒内容自动化工作流

## 📋 功能概述

这是一个完整的**AI驱动型社媒内容生成系统**,基于企业知识库自动提炼高价值关键词,裂变长尾词,并批量生成符合各平台特性的社媒内容。

### 核心流程

```
知识库分析 → 提取核心关键词 → 裂变长尾词 → 企业画像注入 → 批量生成内容 → 智能配图
```

---

## ✨ 核心特性

### 1. **必须依赖知识库** ✅
- 从企业能力画像中提取关键词
- 基于产品、技术、行业、场景等维度分析
- 确保生成的内容与企业业务高度相关

### 2. **可以引用知识库** ✅
- 自动关联相关产品和技术优势
- 引用客户案例和痛点解决方案
- 体现企业差异化卖点

### 3. **企业画像自动注入** ✅
- 业务概述自动融入上下文
- 技术优势和产品信息智能匹配
- 目标行业和场景精准定位

### 4. **设计上有集成能力** ✅
- 模块化架构,易于扩展
- API接口标准化
- 支持自定义平台和语气风格

### 5. **智能配图** ✅
- 从资产库匹配现成图片(开发中)
- 生成AI绘图提示词
- 按平台要求优化图片尺寸

---

## 🚀 使用方法

### 方式一:通过前端界面

1. **进入声量枢纽页面**
   - 访问 `/customer/social`

2. **点击"AI 关键词生成"按钮**
   - 紫色渐变按钮,带有 Sparkles 图标

3. **配置生成参数**
   ```
   - 目标平台: LinkedIn, Twitter/X, Facebook, Instagram, TikTok, WeChat
   - 语气风格: 专业/轻松/幽默/教育性/激励性
   - 核心词数量: 10-50个 (默认30)
   - 每个核心词裂变的长尾词数: 5-20个 (默认10)
   - 最小搜索量: 10-1000 (默认50)
   ```

4. **点击"开始生成"**
   - 系统会自动完成以下步骤:
     - ① 从知识库提取核心关键词
     - ② 为每个核心词裂变长尾词
     - ③ 批量生成社媒内容
     - ④ 返回结果

5. **查看和导出结果**
   - "关键词"标签页:查看所有挖掘出的关键词
   - "生成内容"标签页:查看每个关键词对应的社媒文案
   - 每条内容包含:
     - 文案正文
     - Hashtags
     - CTA (行动号召)
     - 配图建议/提示词

### 方式二:通过API调用

```bash
POST /api/social/generate-from-keywords
Content-Type: application/json
Authorization: Bearer <your-token>

{
  "maxCoreKeywords": 30,
  "maxLongTailPerCore": 10,
  "minSearchVolume": 50,
  "platforms": ["linkedin", "x", "facebook"],
  "tone": "professional",
  "language": "zh-CN",
  "targetRegion": "中国",
  "targetIndustries": ["制造业", "工业"]
}
```

**响应示例:**
```json
{
  "success": true,
  "data": {
    "keywords": {
      "core": [
        {
          "id": "kw-core-xxx",
          "term": "工业自动化解决方案",
          "category": "product",
          "metrics": {
            "searchVolume": 8500,
            "competition": "medium",
            "commercialIntent": 0.75,
            "relevance": 0.92
          },
          "confidence": 0.88
        }
      ],
      "longTail": [
        {
          "id": "kw-lt-xxx",
          "coreKeywordId": "kw-core-xxx",
          "term": "如何实现工厂自动化改造",
          "category": "scenario",
          "metrics": {
            "searchVolume": 1200,
            "competition": "low",
            "commercialIntent": 0.65,
            "relevance": 0.85
          },
          "contentAngle": "教育性内容: 解释\"如何实现工厂自动化改造\"的概念和价值",
          "searchIntent": "informational"
        }
      ],
      "stats": {
        "totalCoreKeywords": 30,
        "totalLongTailKeywords": 285,
        "avgSearchVolume": 2450,
        "highValueKeywords": 42
      }
    },
    "contents": [
      {
        "text": "🏭 工厂自动化改造不是遥不可及的梦想...\n[完整文案]",
        "hashtags": ["#工业自动化", "#智能制造", "#数字化转型"],
        "cta": "立即咨询我们的自动化专家 →",
        "imagePrompt": "一张现代化工厂的航拍照片...",
        "metadata": {
          "keywordUsed": "如何实现工厂自动化改造",
          "searchIntent": "informational",
          "contentAngle": "教育性内容",
          "estimatedReadTime": 15
        }
      }
    ],
    "stats": {
      "totalGenerated": 60,
      "successCount": 58,
      "failedCount": 2,
      "avgLength": 245
    }
  }
}
```

---

## 📁 文件结构

```
src/
├── lib/
│   ├── social-keyword-engine.ts      # 关键词挖掘与裂变引擎
│   ├── social-content-generator.ts   # 增强版内容生成器
│   └── social-image-matcher.ts       # 智能配图引擎
├── app/
│   └── api/
│       └── social/
│           └── generate-from-keywords/
│               └── route.ts          # API路由
└── components/
    └── keyword-driven-content-generator.tsx  # 前端组件
```

---

## 🔧 技术实现细节

### 1. 关键词挖掘 (`social-keyword-engine.ts`)

**核心函数:**
- `extractCoreKeywords()` - 从知识库提取核心关键词
- `expandLongTailKeywords()` - 裂变长尾关键词
- `runKeywordExpansionPipeline()` - 完整流水线

**AI提示词策略:**
```typescript
// 系统提示词强调:
- SEO专业知识
- 高搜索量优先
- 商业意图明确
- 避免通用词

// 裂变策略:
- 问题型: "如何...", "什么是..."
- 比较型: "... vs ...", "最佳..."
- 场景型: "[行业] + [核心词]"
- 地域型: "[城市] + [核心词]"
- 购买型: "购买...", "... 价格"
```

**评分算法:**
```typescript
score = 
  searchVolume * 0.3 +      // 搜索量权重
  commercialIntent * 0.25 +  // 商业意图
  relevance * 0.3 +          // 相关性
  competitionScore * 0.15    // 竞争程度
```

### 2. 内容生成 (`social-content-generator.ts`)

**企业画像注入流程:**
```typescript
1. getCompanyProfile() - 获取企业能力画像
2. buildKnowledgeContext() - 构建知识库上下文
   - 业务概述
   - 相关产品 (语义匹配)
   - 技术优势 (关键词匹配)
   - 目标行业
   - 客户痛点
   - 差异化卖点
3. 将上下文注入到AI提示词中
```

**平台适配:**
```typescript
LinkedIn:   专业B2B, 150-300字, 数据驱动
Twitter/X:  简洁有力, ≤280字符, emoji分隔
Facebook:   故事化, 100-250字, 社区感
Instagram:  视觉化, 50-150字, 生活方式
TikTok:     年轻化, 50-100字, 娱乐化
WeChat:     深度内容, 200-500字, 权威性
```

### 3. 智能配图 (`social-image-matcher.ts`)

**匹配策略:**
```typescript
1. 查询企业资产库 (TODO: 向量相似度匹配)
2. 如果没有匹配到,生成AI绘图提示词
3. 根据平台要求调整图片尺寸
   - LinkedIn: 1200x627 (1.91:1)
   - X: 1200x675 (16:9)
   - Instagram: 1080x1080 (1:1)
   - TikTok: 1080x1920 (9:16)
```

---

## 🎯 四个维度的实现验证

| 维度 | 要求 | 实现状态 | 说明 |
|------|------|---------|------|
| **必须依赖知识库** | 关键词提取依赖企业数据 | ✅ 已完成 | `extractCoreKeywords()` 强制要求 `getCompanyProfile()` |
| **可以引用知识库** | 内容生成引用企业信息 | ✅ 已完成 | `buildKnowledgeContext()` 自动注入相关业务信息 |
| **企业画像自动注入** | 无需手动选择,系统自动匹配 | ✅ 已完成 | 基于关键词语义自动关联产品、技术、行业等 |
| **设计上有集成能力** | 预留扩展接口 | ✅ 已完成 | 模块化设计,API标准化,支持自定义平台 |

---

## 📊 性能指标

**典型执行时间:**
- 关键词提取: ~3-5秒 (30个核心词)
- 长尾词裂变: ~8-12秒 (300个长尾词)
- 内容生成: ~15-30秒 (60条内容,3个平台)
- **总计**: ~30-50秒

**API调用次数:**
- 1次提取核心词
- N次裂变长尾词 (每个核心词1次)
- M次生成内容 (关键词数 × 平台数)

**并发控制:**
- 内容生成并发度: 3-5个
- 批次间隔: 500ms
- 避免API限流

---

## 🔄 后续优化方向

### 短期 (1-2周)
1. **实现图片资产库匹配**
   - 使用向量嵌入计算内容-图片相似度
   - 集成现有的 Asset 管理系统

2. **添加关键词保存功能**
   - 将挖掘的关键词存入数据库
   - 支持历史关键词检索和复用

3. **增加A/B测试能力**
   - 为同一关键词生成多个版本的内容
   - 统计不同版本的互动数据

### 中期 (1个月)
1. **接入真实AI生图API**
   - DALL-E 3 或 Midjourney集成
   - 自动生成配图并附加到内容

2. **SEO数据增强**
   - 集成Google Keyword Planner API
   - 获取真实的搜索量和竞争数据

3. **内容质量评分**
   - 训练分类模型评估内容质量
   - 自动过滤低质量生成结果

### 长期 (3个月)
1. **多语言支持**
   - 英语、日语、韩语等多语言关键词挖掘
   - 跨市场内容策略

2. **竞品分析**
   - 爬取竞品社媒内容
   - 提取差异化关键词

3. **自动化发布调度**
   - 根据关键词热度自动安排发布时间
   - 智能分配不同平台的内容节奏

---

## 🐛 故障排查

### 问题1: "未找到企业能力画像"
**原因**: 知识库尚未完成分析  
**解决**: 先到"知识管理"模块完成素材分析和能力画像生成

### 问题2: AI返回空结果
**原因**: API调用失败或超时  
**解决**: 
- 检查 `DASHSCOPE_API_KEY` 环境变量
- 确认网络连接正常
- 降低并发数 (`concurrency` 参数)

### 问题3: 关键词质量不高
**原因**: 知识库素材不够丰富  
**解决**:
- 上传更多企业文档(PDF, Word, PPT)
- 导入官网页面
- 完善产品和技术描述

### 问题4: 生成速度慢
**原因**: 批量处理大量内容  
**解决**:
- 减少 `maxCoreKeywords` 和 `maxLongTailPerCore`
- 选择更少的目标平台
- 使用高价值的关键词筛选

---

## 📞 技术支持

如有问题或建议,请联系:
- 开发团队: dev@vertax.pro
- 产品反馈: product@vertax.pro

---

## 📝 更新日志

### v1.0.0 (2026-02-06)
- ✅ 初始版本发布
- ✅ 关键词挖掘与裂变引擎
- ✅ 企业画像自动注入
- ✅ 批量内容生成
- ✅ 智能配图提示词生成
- ✅ 前端可视化界面
- ✅ API接口开放

---

**祝使用愉快! 🚀**
