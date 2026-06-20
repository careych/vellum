import { type NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

const R2_URL = process.env.R2_PUBLIC_URL!

function escapeCsv(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? '"' + s.replace(/"/g, '""') + '"'
    : s
}

export async function GET(request: NextRequest) {
  // ── Auth: admin only ──────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const format = request.nextUrl.searchParams.get('format') ?? 'json'
  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json({ error: 'format must be json or csv' }, { status: 400 })
  }

  // ── Fetch all catalog data (4 parallel queries) ───────────────────────────────
  const [imagesResult, albumsResult, tagsResult, imageTagsResult] = await Promise.all([
    supabase.from('images').select('*').order('uploaded_at'),
    supabase.from('albums').select('id, name').order('name'),
    supabase.from('tags').select('id, name').order('name'),
    supabase.from('image_tags').select('image_id, tag_id'),
  ])

  if (imagesResult.error) {
    return NextResponse.json({ error: imagesResult.error.message }, { status: 500 })
  }

  const images = imagesResult.data ?? []
  const albums = albumsResult.data ?? []
  const tags = tagsResult.data ?? []
  const imageTags = imageTagsResult.data ?? []

  // Build lookup maps
  const albumNameMap: Record<string, string> = Object.fromEntries(
    albums.map((a: { id: string; name: string }) => [a.id, a.name])
  )
  const tagNameMap: Record<string, string> = Object.fromEntries(
    tags.map((t: { id: string; name: string }) => [t.id, t.name])
  )
  const imageTagMap: Record<string, string[]> = {}
  for (const it of imageTags as { image_id: string; tag_id: string }[]) {
    if (!imageTagMap[it.image_id]) imageTagMap[it.image_id] = []
    const name = tagNameMap[it.tag_id]
    if (name) imageTagMap[it.image_id].push(name)
  }

  // Flatten each image row with human-readable derived fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enriched = images.map((img: any) => ({
    id: img.id,
    name: img.name,
    note: img.note,
    taken_at: img.taken_at,
    uploaded_at: img.uploaded_at,
    album_id: img.album_id,
    album_name: img.album_id ? (albumNameMap[img.album_id] ?? null) : null,
    tags: (imageTagMap[img.id] ?? []).join(', '),
    source_type: img.source_type,
    original_url: img.r2_object_key ? `${R2_URL}/${img.r2_object_key}` : (img.external_url ?? null),
    thumbnail_url: img.thumbnail_key ? `${R2_URL}/${img.thumbnail_key}` : null,
    r2_object_key: img.r2_object_key,
    thumbnail_key: img.thumbnail_key,
    external_url: img.external_url,
    width: img.width,
    height: img.height,
    file_size: img.file_size,
    mime_type: img.mime_type,
  }))

  const date = new Date().toISOString().split('T')[0]

  if (format === 'csv') {
    const cols = [
      'id', 'name', 'note', 'taken_at', 'uploaded_at',
      'album_id', 'album_name', 'tags', 'source_type',
      'original_url', 'thumbnail_url', 'r2_object_key', 'thumbnail_key',
      'external_url', 'width', 'height', 'file_size', 'mime_type',
    ] as const
    const lines = [
      cols.join(','),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...enriched.map((row: any) => cols.map((c) => escapeCsv(row[c])).join(',')),
    ]
    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="vellum-export-${date}.csv"`,
      },
    })
  }

  return NextResponse.json(
    {
      exported_at: new Date().toISOString(),
      stats: { images: images.length, albums: albums.length, tags: tags.length },
      albums,
      tags,
      images: enriched,
    },
    {
      headers: {
        'Content-Disposition': `attachment; filename="vellum-export-${date}.json"`,
      },
    }
  )
}
