import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

import { getClientIp, rateLimit } from '@/lib/ratelimit'
import { deleteObject, getPublicUrl, uploadObject } from '@/lib/r2'
import { FromUrlBodySchema } from '@/lib/schemas'
import { createClient } from '@/lib/supabase/server'

const MAX_SIZE = 100 * 1024 * 1024 // 100 MB
const TIMEOUT_MS = 30_000

// Convert common Google Drive share URLs to direct-download form.
// Only works for files shared as "Anyone with the link".
function resolveGoogleDriveUrl(url: string): string {
  const fileId =
    url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] ??
    url.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1]
  if (!fileId) return url
  return `https://drive.google.com/uc?export=download&id=${fileId}`
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Rate limit: 20 imports per minute per IP ─────────────────────────────────
  const ip = getClientIp(request.headers)
  if (!rateLimit(`from-url:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // ── Validate body ────────────────────────────────────────────────────────────
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = FromUrlBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 }
    )
  }

  const { url: rawUrl, mode } = parsed.data
  const isDrive = rawUrl.includes('drive.google.com')
  const url = isDrive ? resolveGoogleDriveUrl(rawUrl.trim()) : rawUrl.trim()

  // ── MODE A: Reference only ────────────────────────────────────────────────
  if (mode === 'reference') {
    let mimeType: string
    try {
      const head = await fetchWithTimeout(url, { method: 'HEAD' })
      mimeType = (head.headers.get('content-type') ?? '').split(';')[0].trim()
    } catch (e) {
      const msg = e instanceof Error && e.name === 'AbortError'
        ? 'Request timed out — check the URL is publicly accessible'
        : 'Could not reach URL — check it is publicly accessible'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    if (!mimeType.startsWith('image/')) {
      return NextResponse.json(
        { error: `URL does not point to an image (server returned: ${mimeType || 'unknown'})` },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('images')
      .insert({
        source_type: 'external',
        external_url: rawUrl.trim(),
        mime_type: mimeType,
        r2_object_key: null,
        thumbnail_key: null,
        width: null,
        height: null,
        file_size: null,
        taken_at: null,
      })
      .select('id')
      .single()

    if (error) {
      console.error('reference insert failed:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ id: data.id, mode: 'reference' })
  }

  // ── MODE B: Import to permanent R2 storage ────────────────────────────────
  let imageBuffer: Buffer
  let mimeType: string

  try {
    const res = await fetchWithTimeout(url)
    if (!res.ok) {
      return NextResponse.json(
        { error: `Could not fetch image: HTTP ${res.status}. ${isDrive ? 'Make sure the file is shared publicly ("Anyone with the link").' : ''}` },
        { status: 400 }
      )
    }

    mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!mimeType.startsWith('image/')) {
      return NextResponse.json(
        {
          error: isDrive
            ? `Google Drive returned "${mimeType || 'unknown'}" instead of an image. The file may be private or too large for direct download.`
            : `URL does not point to an image (got: ${mimeType || 'unknown'})`,
        },
        { status: 400 }
      )
    }

    const contentLength = Number(res.headers.get('content-length') ?? 0)
    if (contentLength > MAX_SIZE) {
      return NextResponse.json({ error: 'Image too large (max 100 MB)' }, { status: 400 })
    }

    imageBuffer = Buffer.from(await res.arrayBuffer())
    if (imageBuffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: 'Image too large (max 100 MB)' }, { status: 400 })
    }
  } catch (e) {
    const msg =
      e instanceof Error && e.name === 'AbortError'
        ? 'Fetch timed out after 30 s — the server may be slow or the URL may require authentication'
        : 'Could not fetch image — check the URL is publicly accessible'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // Process with sharp: get dimensions + generate thumbnail
  let width: number, height: number, thumbBuffer: Buffer
  try {
    const img = sharp(imageBuffer)
    const meta = await img.metadata()
    width = meta.width ?? 0
    height = meta.height ?? 0
    thumbBuffer = await img
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()
  } catch {
    return NextResponse.json(
      { error: 'Could not process image — format may be unsupported' },
      { status: 400 }
    )
  }

  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  const origKey = `originals/${randomUUID()}.${ext}`
  const thumbKey = `thumbnails/${randomUUID()}.jpg`

  try {
    await uploadObject(origKey, imageBuffer, mimeType)
  } catch {
    return NextResponse.json({ error: 'Failed to upload original to storage' }, { status: 500 })
  }

  try {
    await uploadObject(thumbKey, thumbBuffer, 'image/jpeg')
  } catch {
    await deleteObject(origKey).catch(() => {})
    return NextResponse.json({ error: 'Failed to upload thumbnail to storage' }, { status: 500 })
  }

  const { data, error } = await supabase
    .from('images')
    .insert({
      source_type: 'upload',
      r2_object_key: origKey,
      thumbnail_key: thumbKey,
      external_url: rawUrl.trim(),
      width,
      height,
      file_size: imageBuffer.byteLength,
      mime_type: mimeType,
      taken_at: null,
    })
    .select('id')
    .single()

  if (error) {
    await Promise.allSettled([deleteObject(origKey), deleteObject(thumbKey)])
    console.error('import insert failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    id: data.id,
    mode: 'import',
    publicUrl: getPublicUrl(origKey),
    thumbnailUrl: getPublicUrl(thumbKey),
  })
}
