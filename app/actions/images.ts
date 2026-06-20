'use server'

import { deleteObject } from '@/lib/r2'
import { UpdateMetaSchema } from '@/lib/schemas'
import { createClient } from '@/lib/supabase/server'

export async function updateImageMetadata(
  imageId: string,
  meta: {
    name: string
    note: string
    albumId: string | null | undefined
    tags: string[]
    takenAt?: string | null
  }
): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Validate all user-supplied strings before touching the database
  const validated = UpdateMetaSchema.parse({
    name: meta.name,
    note: meta.note,
    albumId: meta.albumId,
    tags: meta.tags,
    takenAt: meta.takenAt,
  })

  const update: Record<string, unknown> = {
    name: validated.name || null,
    note: validated.note || null,
    album_id: validated.albumId || null,
  }
  if ('takenAt' in meta) update.taken_at = validated.takenAt ?? null

  const { error: imgErr } = await supabase.from('images').update(update).eq('id', imageId)
  if (imgErr) throw imgErr

  await supabase.from('image_tags').delete().eq('image_id', imageId)

  const cleanTags = validated.tags.map((t) => t.trim()).filter(Boolean)
  if (cleanTags.length === 0) return

  await supabase
    .from('tags')
    .upsert(cleanTags.map((name) => ({ name })), { onConflict: 'name', ignoreDuplicates: true })

  const { data: tagRows, error: tagErr } = await supabase
    .from('tags')
    .select('id')
    .in('name', cleanTags)

  if (tagErr) throw tagErr
  if (!tagRows?.length) return

  const { error: itErr } = await supabase
    .from('image_tags')
    .insert(tagRows.map((t) => ({ image_id: imageId, tag_id: t.id })))

  if (itErr) throw itErr
}

export async function deleteImage(imageId: string): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: img } = await supabase
    .from('images')
    .select('r2_object_key, thumbnail_key')
    .eq('id', imageId)
    .single()

  // Delete DB row first (image_tags cascade). If this fails, R2 stays intact.
  const { error } = await supabase.from('images').delete().eq('id', imageId)
  if (error) throw error

  // Delete R2 objects after DB row is gone. Failures are logged, not thrown —
  // orphaned R2 objects are acceptable; a broken DB reference is not.
  if (img?.r2_object_key) await deleteObject(img.r2_object_key).catch(console.error)
  if (img?.thumbnail_key) await deleteObject(img.thumbnail_key).catch(console.error)
}
