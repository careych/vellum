import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'

import { getClientIp, rateLimit } from '@/lib/ratelimit'
import { getPresignedUploadUrl, getPublicUrl } from '@/lib/r2'
import { PresignBodySchema } from '@/lib/schemas'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/avif',
])

const MAX_SIZE = 100 * 1024 * 1024 // 100 MB

export async function POST(request: NextRequest) {
  // ── Auth: only the logged-in admin may generate upload URLs ─────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Rate limit: 60 presign requests per minute per IP ───────────────────────
  const ip = getClientIp(request.headers)
  if (!rateLimit(`presign:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // ── Validate request body with Zod ──────────────────────────────────────────
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = PresignBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { fileName, contentType, fileSize, prefix: rawPrefix } = parsed.data
  const prefix = rawPrefix === 'thumbnails' ? 'thumbnails' : 'originals'

  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }

  const maxSize = prefix === 'thumbnails' ? 5 * 1024 * 1024 : MAX_SIZE
  if (fileSize > maxSize) {
    return NextResponse.json(
      { error: `File too large (max ${prefix === 'thumbnails' ? '5' : '100'} MB)` },
      { status: 400 }
    )
  }

  const ext = prefix === 'thumbnails' ? 'jpg' : (fileName?.split('.').pop()?.toLowerCase() ?? 'bin')
  const key = `${prefix}/${randomUUID()}.${ext}`

  const presignedUrl = await getPresignedUploadUrl(key, contentType)

  return NextResponse.json({
    presignedUrl,
    key,
    publicUrl: getPublicUrl(key),
  })
}
