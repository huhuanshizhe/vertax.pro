import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { publishSocialPost } from "@/actions/social";

/**
 * 单篇内容直接发布 — 先创建 SocialPost，再调用 publish
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId || !session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { platform, content, hashtags, keyword } = await request.json();
    if (!platform || !content) {
      return NextResponse.json({ error: "platform and content are required" }, { status: 400 });
    }

    // 1. 创建 SocialPost
    const post = await db.socialPost.create({
      data: {
        tenantId: session.user.tenantId,
        authorId: session.user.id,
        title: `[AI] ${keyword || "社媒内容"}`,
        status: "draft",
        versions: {
          create: {
            platform,
            content,
            media: [],
            metrics: { hashtags: hashtags || [] },
          },
        },
      },
      include: { versions: true },
    });

    // 2. 发布
    const result = await publishSocialPost(post.id);

    return NextResponse.json({
      success: result.success,
      postId: post.id,
      results: result.results,
    });
  } catch (error) {
    console.error("[publish-single] Error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
