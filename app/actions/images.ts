'use server'

import { createClient } from '@/lib/supabase/server'

export async function updateImageMetadata(
  imageId: string,
  meta: {
    name: string
    note: string
    albumId: string | null
    tags: string[]
  }
): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { error: imgErr } = await supabase
    .from('images')
    .update({
      name: meta.name || null,
      note: meta.note || null,
      album_id: meta.albumId || null,
    })
    .eq('id', imageId)

  if (imgErr) throw imgErr

  // Clear existing tags then re-apply
  await supabase.from('image_tags').delete().eq('image_id', imageId)

  const cleanTags = meta.tags.map((t) => t.trim()).filter(Boolean)
  if (cleanTags.length === 0) return

  // Upsert tags by name (create if new, ignore if exists)
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
