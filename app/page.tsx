import { createClient } from '@/lib/supabase/server'
import type { Album } from '@/lib/types'
import { Gallery } from './_gallery'

export default async function Home() {
  const supabase = await createClient()

  const [{ data: { user } }, albumsResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('albums').select('id, name, cover_image_id').order('name'),
  ])
  // cover_image_id column may not exist before the Phase 6 migration runs — fall back gracefully
  const albumsData = albumsResult.error ? [] : albumsResult.data

  const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!

  // Resolve cover thumbnails in a second query to avoid join syntax ambiguity
  const coverIds = (albumsData ?? [])
    .map((a: { cover_image_id: string | null }) => a.cover_image_id)
    .filter(Boolean) as string[]

  const coverMap: Record<string, string> = {}
  if (coverIds.length > 0) {
    const { data: coverImgs } = await supabase
      .from('images')
      .select('id, thumbnail_key')
      .in('id', coverIds)
    coverImgs?.forEach((img: { id: string; thumbnail_key: string | null }) => {
      if (img.thumbnail_key) coverMap[img.id] = `${R2_PUBLIC_URL}/${img.thumbnail_key}`
    })
  }

  const albums: Album[] = (albumsData ?? []).map(
    (a: { id: string; name: string; cover_image_id: string | null }) => ({
      id: a.id,
      name: a.name,
      cover_thumbnail_url: a.cover_image_id ? (coverMap[a.cover_image_id] ?? null) : null,
    })
  )

  return <Gallery initialAlbums={albums} isAdmin={!!user} />
}
