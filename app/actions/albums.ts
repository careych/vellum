'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  return supabase
}

export async function createAlbum(name: string): Promise<string> {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from('albums')
    .insert({ name: name.trim() })
    .select('id')
    .single()
  if (error) throw error
  revalidatePath('/')
  return data.id
}

export async function updateAlbum(
  albumId: string,
  update: { name?: string; cover_image_id?: string | null }
): Promise<void> {
  const supabase = await requireAdmin()
  const { error } = await supabase.from('albums').update(update).eq('id', albumId)
  if (error) throw error
  revalidatePath('/')
}

export async function deleteAlbum(albumId: string): Promise<void> {
  const supabase = await requireAdmin()
  // Unset album_id on images — images themselves are kept
  await supabase.from('images').update({ album_id: null }).eq('album_id', albumId)
  const { error } = await supabase.from('albums').delete().eq('id', albumId)
  if (error) throw error
  revalidatePath('/')
}
