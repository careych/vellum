import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'

import { getPresignedUploadUrl, getPublicUrl } from '@/lib/r2'
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
  // Only the logged-in admin may generate upload URLs
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { fileName?: string; contentType?: string; fileSize?: number; prefix?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { fileName, contentType, fileSize, prefix: rawPrefix } = body
  const prefix = rawPrefix === 'thumbnails' ? 'thumbnails' : 'originals'

  if (!contentType || !ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }

  const maxSize = prefix === 'thumbnails' ? 5 * 1024 * 1024 : MAX_SIZE
  if (!fileSize || fileSize <= 0 || fileSize > maxSize) {
    return NextResponse.json(
      { error: `Invalid file size (max ${prefix === 'thumbnails' ? '5' : '100'} MB)` },
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
