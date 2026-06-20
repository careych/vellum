import { type NextRequest, NextResponse } from 'next/server'

import { deleteObject } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    r2_object_key?: string
    thumbnail_key?: string | null
    width?: number
    height?: number
    file_size?: number
    mime_type?: string
    taken_at?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { r2_object_key, thumbnail_key, width, height, file_size, mime_type, taken_at } = body

  if (!r2_object_key || !width || !height || !file_size || !mime_type) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

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
    return NextResponse.json({ error: 'Failed to save image record' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id })
}
