export type ImageItem = {
  id: string
  name: string | null
  taken_at: string | null
  uploaded_at: string
  thumbnail_url: string | null
  original_url: string | null
  source_type: string
  width: number | null
  height: number | null
  album_id: string | null
  album_name: string | null
}

export type ImageDetail = ImageItem & {
  note: string | null
  file_size: number | null
  mime_type: string | null
  external_url: string | null
  tags: string[]
}

export type Album = {
  id: string
  name: string
  cover_thumbnail_url: string | null
}
