import { type NextRequest, NextResponse } from 'next/server'

import { deleteObject } from '@/lib/r2'
import { ListParamsSchema, SaveImageBodySchema } from '@/lib/schemas'
import { createClient } from '@/lib/supabase/server'
import type { ImageItem } from '@/lib/types'

const R2_URL = process.env.R2_PUBLIC_URL!

type SortOption = 'uploaded_desc' | 'uploaded_asc' | 'taken_desc' | 'taken_asc' | 'name_asc'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const parsed = ListParamsSchema.safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }
  const { page, limit, album_id: albumId, q, tag, from, to, sort } = parsed.data

  // Tag pre-filter: resolve tag → image IDs before the main query
  let tagImageIds: string[] | null = null
  if (tag) {
    const { data: tagRow } = await supabase.from('tags').select('id').eq('name', tag).single()
    if (!tagRow) return NextResponse.json({ images: [], total: 0, hasMore: false })
    const { data: itRows } = await supabase
      .from('image_tags')
      .select('image_id')
      .eq('tag_id', tagRow.id)
    tagImageIds = itRows?.map((r: { image_id: string }) => r.image_id) ?? []
    if (tagImageIds.length === 0) return NextResponse.json({ images: [], total: 0, hasMore: false })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('images')
    .select(
      'id, name, taken_at, uploaded_at, thumbnail_key, r2_object_key, source_type, external_url, width, height, album_id',
      { count: 'exact' }
    )

  if (albumId) query = query.eq('album_id', albumId)
  if (q) query = query.or(`name.ilike.%${q}%,note.ilike.%${q}%`)
  if (from) query = query.gte('taken_at', from)
  if (to) query = query.lte('taken_at', to)
  if (tagImageIds) query = query.in('id', tagImageIds)

  switch (sort) {
    case 'taken_asc':
      query = query
        .order('taken_at', { ascending: true, nullsFirst: false })
        .order('uploaded_at', { ascending: true })
      break
    case 'taken_desc':
      query = query
        .order('taken_at', { ascending: false, nullsFirst: false })
        .order('uploaded_at', { ascending: false })
      break
    case 'uploaded_asc':
      query = query.order('uploaded_at', { ascending: true })
      break
    case 'name_asc':
      query = query.order('name', { ascending: true, nullsFirst: false })
      break
    default:
      query = query.order('uploaded_at', { ascending: false })
  }

  query = query.range(page * limit, page * limit + limit - 1)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const images: ImageItem[] = (data ?? []).map((img: any) => ({
    id: img.id,
    name: img.name,
    taken_at: img.taken_at,
    uploaded_at: img.uploaded_at,
    thumbnail_url: img.thumbnail_key
      ? `${R2_URL}/${img.thumbnail_key}`
      : img.external_url ?? null,
    original_url: img.r2_object_key
      ? `${R2_URL}/${img.r2_object_key}`
      : img.external_url ?? null,
    source_type: img.source_type,
    width: img.width,
    height: img.height,
    album_id: img.album_id,
    album_name: null,
  }))

  return NextResponse.json({
    images,
    total: count ?? 0,
    hasMore: (page + 1) * limit < (count ?? 0),
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const bodyParsed = SaveImageBodySchema.safeParse(rawBody)
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: bodyParsed.error.issues },
      { status: 400 }
    )
  }

  const { r2_object_key, thumbnail_key, width, height, file_size, mime_type, taken_at } = bodyParsed.data

  const { data, error } = await supabase
    .from('images')
    .insert({
      r2_object_key,
      thumbnail_key: thumbnail_key ?? null,
      width,
      height,
      file_size,
      mime_type,
      taken_at: taken_at ?? null,
      source_type: 'upload',
    })
    .select('id')
    .single()

  if (error) {
    // DB insert failed — delete both R2 objects so they don't become orphans.
    // allSettled so a failed delete doesn't mask the original error.
    await Promise.allSettled([
      r2_object_key ? deleteObject(r2_object_key) : Promise.resolve(),
      thumbnail_key ? deleteObject(thumbnail_key) : Promise.resolve(),
    ])
    console.error('images insert failed:', error)
    return NextResponse.json({ error: error.message ?? 'Failed to save image record' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id })
}
