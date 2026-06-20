import { type NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import type { ImageDetail } from '@/lib/types'

const R2_URL = process.env.R2_PUBLIC_URL!

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/images/[id]'>
) {
  const { id } = await ctx.params
  const supabase = await createClient()

  const { data: img, error } = await supabase
    .from('images')
    .select(
      'id, name, note, taken_at, uploaded_at, thumbnail_key, r2_object_key, source_type, external_url, width, height, file_size, mime_type, album_id, albums(name)'
    )
    .eq('id', id)
    .single()

  if (error || !img) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: tagRows } = await supabase
    .from('image_tags')
    .select('tags(name)')
    .eq('image_id', id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tags = tagRows?.flatMap((r: any) => (r.tags?.name ? [r.tags.name as string] : [])) ?? []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = img as any
  const detail: ImageDetail = {
    id: row.id,
    name: row.name,
    note: row.note,
    taken_at: row.taken_at,
    uploaded_at: row.uploaded_at,
    thumbnail_url: row.thumbnail_key
      ? `${R2_URL}/${row.thumbnail_key}`
      : row.external_url ?? null,
    original_url: row.r2_object_key
      ? `${R2_URL}/${row.r2_object_key}`
      : row.external_url ?? null,
    source_type: row.source_type,
    external_url: row.external_url,
    width: row.width,
    height: row.height,
    file_size: row.file_size,
    mime_type: row.mime_type,
    album_id: row.album_id,
    album_name: row.albums?.name ?? null,
    tags,
  }

  return NextResponse.json(detail)
}
