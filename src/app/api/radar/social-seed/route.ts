import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { importSocialSeed, type SocialSeedItem } from '@/lib/radar/social-seed-import';

export const dynamic = 'force-dynamic';

/**
 * POST /api/radar/social-seed
 *
 * Import social page URLs as RadarCandidates for manual triage.
 *
 * Body: { items: SocialSeedItem[] }
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { tenantId, id: userId } = session.user as { tenantId: string; id: string };

  let body: { items?: SocialSeedItem[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'items array is required and must not be empty' }, { status: 400 });
  }

  if (body.items.length > 500) {
    return NextResponse.json({ error: 'Maximum 500 items per request' }, { status: 400 });
  }

  const result = await importSocialSeed({
    tenantId,
    userId,
    items: body.items,
  });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
