import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPlatformAdminRoleName } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

// 与 api-key-resolver.ts 保持一致的 env var 映射
const ENV_KEY_MAP: Record<string, string> = {
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

async function getPlatformAdminUser(userId?: string) {
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });

  if (!user || !isPlatformAdminRoleName(user.role.name)) {
    return null;
  }

  return user;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getPlatformAdminUser(session.user.id);
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 从 DB 读取已保存的配置
    const dbConfigs = await prisma.apiKeyConfig.findMany({
      orderBy: [{ category: "asc" }, { service: "asc" }],
    });

    const dbConfigMap = new Map(dbConfigs.map(c => [c.service, c]));

    // 合并 env 变量中的 key（DB 优先，env 作为 fallback）
    const allServices = Object.keys(ENV_KEY_MAP);
    const mergedConfigs = allServices.map((service) => {
      const dbConfig = dbConfigMap.get(service);
      const envVar = ENV_KEY_MAP[service];
      const hasEnvKey = Boolean(process.env[envVar]?.trim());
      const hasDbKey = Boolean(dbConfig?.apiKey?.trim());

      if (dbConfig) {
        // DB 有记录 → 返回 DB 数据（key 脱敏）
        return {
          ...dbConfig,
          apiKey: dbConfig.apiKey ? "************" : null,
          apiSecret: dbConfig.apiSecret ? "************" : null,
          source: "database" as const,
        };
      }

      if (hasEnvKey) {
        // DB 无记录但 env 有 → 返回 env 状态
        return {
          id: `env-${service}`,
          service,
          category: getCategoryForService(service),
          apiKey: "************", // env key 也脱敏显示
          apiSecret: null,
          isEnabled: true,
          lastUsedAt: null,
          monthlyLimit: null,
          currentUsage: 0,
          usageResetAt: null,
          notes: `通过环境变量 ${envVar} 配置`,
          source: "env" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      // 都没有 → 未配置
      return {
        id: `none-${service}`,
        service,
        category: getCategoryForService(service),
        apiKey: null,
        apiSecret: null,
        isEnabled: false,
        lastUsedAt: null,
        monthlyLimit: null,
        currentUsage: 0,
        usageResetAt: null,
        notes: null,
        source: "none" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });

    return NextResponse.json({ configs: mergedConfigs });
  } catch (error) {
    console.error("Failed to fetch API key configs:", error);
    return NextResponse.json(
      { error: "Failed to fetch configs" },
      { status: 500 }
    );
  }
}

function getCategoryForService(service: string): string {
  const categories: Record<string, string> = {
    dashscope: "AI Provider",
    openrouter: "AI Provider",
    gemini: "AI Provider",
    brave_search: "Search API",
    tavily: "Search API",
    exa: "Search API",
    serper: "Search API",
    serpapi: "Search API",
    firecrawl: "Web Scraping",
    google_places: "Business Data",
    hunter: "Business Data",
    pdl: "Business Data",
    apollo: "Business Data",
    skrapp: "Business Data",
    sam_gov: "Government Procurement",
    ungm: "Government Procurement",
    resend: "Email",
  };
  return categories[service] || "Other";
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getPlatformAdminUser(session.user.id);
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { service, apiKey, apiSecret, monthlyLimit, notes } = body;

    if (!service) {
      return NextResponse.json(
        { error: "Service is required" },
        { status: 400 }
      );
    }

    const validServices = [
      "dashscope",
      "openrouter",
      "gemini",
      "brave_search",
      "tavily",
      "exa",
      "firecrawl",
      "serper",
      "google_places",
      "hunter",
      "pdl",
      "apollo",
      "skrapp",
      "sam_gov",
      "ungm",
    ];

    if (!validServices.includes(service)) {
      return NextResponse.json({ error: "Invalid service" }, { status: 400 });
    }

    const serviceCategories: Record<string, string> = {
      dashscope: "AI Provider",
      openrouter: "AI Provider",
      gemini: "AI Provider",
      brave_search: "Search API",
      tavily: "Search API",
      exa: "Search API",
      serper: "Search API",
      google_places: "Business Data",
      hunter: "Business Data",
      pdl: "Business Data",
      apollo: "Business Data",
      skrapp: "Business Data",
      sam_gov: "Government Procurement",
      ungm: "Government Procurement",
      firecrawl: "Web Scraping",
    };

    const category = serviceCategories[service] || "Other";

    const config = await prisma.apiKeyConfig.upsert({
      where: { service },
      create: {
        service,
        category,
        apiKey: apiKey || null,
        apiSecret: apiSecret || null,
        monthlyLimit: monthlyLimit || null,
        notes: notes || null,
        isEnabled: true,
      },
      update: {
        apiKey: apiKey || null,
        apiSecret: apiSecret || null,
        monthlyLimit: monthlyLimit || null,
        notes: notes || null,
      },
    });

    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error("Failed to save API key config:", error);
    return NextResponse.json(
      { error: "Failed to save config" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getPlatformAdminUser(session.user.id);
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { service, isEnabled } = body;

    if (!service) {
      return NextResponse.json(
        { error: "Service is required" },
        { status: 400 }
      );
    }

    const config = await prisma.apiKeyConfig.update({
      where: { service },
      data: { isEnabled },
    });

    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error("Failed to update API key config:", error);
    return NextResponse.json(
      { error: "Failed to update config" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getPlatformAdminUser(session.user.id);
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const service = searchParams.get("service");

    if (!service) {
      return NextResponse.json(
        { error: "Service is required" },
        { status: 400 }
      );
    }

    await prisma.apiKeyConfig.delete({
      where: { service },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete API key config:", error);
    return NextResponse.json(
      { error: "Failed to delete config" },
      { status: 500 }
    );
  }
}
