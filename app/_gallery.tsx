'use client'

import { useEffect, useRef, useState } from 'react'

import { createAlbum, deleteAlbum, updateAlbum } from '@/app/actions/albums'
import type { Album, ImageItem } from '@/lib/types'

import { Lightbox } from './_lightbox'

type SortOption = 'uploaded_desc' | 'uploaded_asc' | 'taken_desc' | 'taken_asc' | 'name_asc'

export function Gallery({
  initialAlbums,
  isAdmin,
}: {
  initialAlbums: Album[]
  isAdmin: boolean
}) {
  const [albums, setAlbums] = useState<Album[]>(initialAlbums)

  // Filter state
  const [albumFilter, setAlbumFilter] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [sort, setSort] = useState<SortOption>('uploaded_desc')

  // Image list state
  const [images, setImages] = useState<ImageItem[]>([])
  const [nextPage, setNextPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)

  // Lightbox
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  // Album CRUD state
  const [showNewAlbum, setShowNewAlbum] = useState(false)
  const [newAlbumName, setNewAlbumName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [albumBusy, setAlbumBusy] = useState(false)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  // Refs used by the IntersectionObserver (avoid stale closures)
  const isFetching = useRef(false)
  const nextPageRef = useRef(0)
  const hasMoreRef = useRef(true)
  const filtersRef = useRef({ debouncedQ, albumFilter, tagFilter, fromDate, toDate, sort })

  // Keep refs in sync every render
  nextPageRef.current = nextPage
  hasMoreRef.current = hasMore
  filtersRef.current = { debouncedQ, albumFilter, tagFilter, fromDate, toDate, sort }

  function buildParams(page: number, f: typeof filtersRef.current) {
    const p = new URLSearchParams({ page: String(page), sort: f.sort })
    if (f.debouncedQ) p.set('q', f.debouncedQ)
    if (f.albumFilter) p.set('album_id', f.albumFilter)
    if (f.tagFilter) p.set('tag', f.tagFilter)
    if (f.fromDate) p.set('from', f.fromDate)
    if (f.toDate) p.set('to', f.toDate)
    return p
  }

  function doFetch(page: number, replace: boolean, filters: typeof filtersRef.current) {
    if (isFetching.current) return
    isFetching.current = true
    setLoading(true)

    fetch(`/api/images?${buildParams(page, filters)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(({ images: imgs, hasMore: more }: { images: ImageItem[]; hasMore: boolean }) => {
        setImages((prev) => (replace ? imgs : [...prev, ...imgs]))
        setHasMore(more)
        setNextPage(page + 1)
      })
      .catch(console.error)
      .finally(() => {
        setLoading(false)
        isFetching.current = false
      })
  }

  // Reset + fetch page 0 when any filter changes
  useEffect(() => {
    setImages([])
    setNextPage(0)
    setHasMore(true)
    doFetch(0, true, { debouncedQ, albumFilter, tagFilter, fromDate, toDate, sort })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, albumFilter, tagFilter, fromDate, toDate, sort])

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sentinelRef.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        if (!hasMoreRef.current || isFetching.current) return
        doFetch(nextPageRef.current, false, filtersRef.current)
      },
      { rootMargin: '300px' }
    )
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Album handlers
  async function handleCreateAlbum() {
    if (!newAlbumName.trim() || albumBusy) return
    setAlbumBusy(true)
    try {
      const id = await createAlbum(newAlbumName.trim())
      setAlbums((prev) => [...prev, { id, name: newAlbumName.trim(), cover_thumbnail_url: null }])
      setNewAlbumName('')
      setShowNewAlbum(false)
    } finally {
      setAlbumBusy(false)
    }
  }

  async function handleDeleteAlbum(albumId: string) {
    if (!confirm('Delete this album? Photos in it will be kept.') || albumBusy) return
    setAlbumBusy(true)
    try {
      await deleteAlbum(albumId)
      setAlbums((prev) => prev.filter((a) => a.id !== albumId))
      if (albumFilter === albumId) setAlbumFilter(null)
    } finally {
      setAlbumBusy(false)
    }
  }

  async function handleRenameAlbum(albumId: string) {
    const album = albums.find((a) => a.id === albumId)
    if (!renameValue.trim() || renameValue.trim() === album?.name) {
      setRenamingId(null)
      return
    }
    setAlbumBusy(true)
    try {
      await updateAlbum(albumId, { name: renameValue.trim() })
      setAlbums((prev) =>
        prev.map((a) => (a.id === albumId ? { ...a, name: renameValue.trim() } : a))
      )
      setRenamingId(null)
    } finally {
      setAlbumBusy(false)
    }
  }

  function clearFilters() {
    setQ('')
    setTagFilter('')
    setFromDate('')
    setToDate('')
  }

  const hasFilters = q || tagFilter || fromDate || toDate

  return (
    <div className="flex gap-6">
      {/* Album sidebar */}
      <aside className="w-52 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Albums
          </span>
          {isAdmin && (
            <button
              onClick={() => setShowNewAlbum((v) => !v)}
              className="text-muted-foreground hover:text-foreground text-lg leading-none"
              title="New album"
            >
              +
            </button>
          )}
        </div>

        {/* Create album form */}
        {showNewAlbum && (
          <div className="mb-2 flex gap-1">
            <input
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              placeholder="Album name"
              className="flex-1 text-sm px-2 py-1 rounded border border-input bg-background"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateAlbum()
                if (e.key === 'Escape') {
                  setShowNewAlbum(false)
                  setNewAlbumName('')
                }
              }}
              autoFocus
              disabled={albumBusy}
            />
            <button
              onClick={handleCreateAlbum}
              disabled={albumBusy || !newAlbumName.trim()}
              className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded disabled:opacity-50"
            >
              OK
            </button>
          </div>
        )}

        {/* All photos */}
        <button
          onClick={() => setAlbumFilter(null)}
          className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
            albumFilter === null
              ? 'bg-accent font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        >
          All photos
        </button>

        {/* Album list */}
        <div className="mt-1 space-y-0.5">
          {albums.map((album) => (
            <div key={album.id} className="group flex items-center gap-1.5">
              {/* Cover thumbnail */}
              {album.cover_thumbnail_url ? (
                <img
                  src={album.cover_thumbnail_url}
                  alt=""
                  className="w-5 h-5 rounded object-cover shrink-0 opacity-80"
                />
              ) : (
                <span className="w-5 h-5 shrink-0" />
              )}

              {renamingId === album.id ? (
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameAlbum(album.id)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={() => handleRenameAlbum(album.id)}
                  className="flex-1 min-w-0 text-sm px-1 py-0.5 rounded border border-input bg-background"
                  autoFocus
                  disabled={albumBusy}
                />
              ) : (
                <button
                  onClick={() => setAlbumFilter(album.id)}
                  className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-md text-sm truncate transition-colors ${
                    albumFilter === album.id
                      ? 'bg-accent font-medium'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                >
                  {album.name}
                </button>
              )}

              {isAdmin && renamingId !== album.id && (
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => {
                      setRenamingId(album.id)
                      setRenameValue(album.name)
                    }}
                    className="p-0.5 text-muted-foreground hover:text-foreground text-xs"
                    title="Rename"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => handleDeleteAlbum(album.id)}
                    className="p-0.5 text-muted-foreground hover:text-destructive text-xs"
                    title="Delete album"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            type="search"
            placeholder="Search name or note…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="text-sm px-3 py-1.5 rounded-md border border-input bg-background w-52 outline-none focus:ring-1 focus:ring-ring"
          />

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="text-sm px-3 py-1.5 rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="uploaded_desc">Newest upload</option>
            <option value="uploaded_asc">Oldest upload</option>
            <option value="taken_desc">Newest taken</option>
            <option value="taken_asc">Oldest taken</option>
            <option value="name_asc">Name A → Z</option>
          </select>

          <input
            type="text"
            placeholder="Tag…"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="text-sm px-3 py-1.5 rounded-md border border-input bg-background w-28 outline-none focus:ring-1 focus:ring-ring"
          />

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="text-sm px-2 py-1.5 rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">—</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="text-sm px-2 py-1.5 rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Clear
            </button>
          )}
        </div>

        {/* Image grid */}
        {images.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
            {hasFilters || albumFilter ? 'No photos match these filters.' : 'No photos yet.'}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
            {images.map((img, i) => (
              <button
                key={img.id}
                onClick={() => setSelectedIndex(i)}
                className="aspect-square overflow-hidden rounded group relative focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              >
                {img.thumbnail_url ? (
                  <img
                    src={img.thumbnail_url}
                    alt={img.name ?? ''}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center text-muted-foreground text-xs">
                    No preview
                  </div>
                )}
                {img.name && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-white text-xs truncate">{img.name}</p>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Spinner */}
        {loading && (
          <div className="flex justify-center py-10">
            <div className="w-5 h-5 border-2 border-muted-foreground border-t-foreground rounded-full animate-spin" />
          </div>
        )}

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-1" />
      </div>

      {/* Lightbox */}
      {selectedIndex !== null && images[selectedIndex] && (
        <Lightbox
          imageId={images[selectedIndex].id}
          isAdmin={isAdmin}
          albums={albums}
          hasPrev={selectedIndex > 0}
          hasNext={selectedIndex < images.length - 1}
          onPrev={() => setSelectedIndex((i) => (i !== null ? Math.max(0, i - 1) : null))}
          onNext={() =>
            setSelectedIndex((i) => (i !== null ? Math.min(images.length - 1, i + 1) : null))
          }
          onClose={() => setSelectedIndex(null)}
          onDelete={(id) => {
            setImages((prev) => prev.filter((img) => img.id !== id))
            setSelectedIndex(null)
          }}
          onSetCover={(albumId, thumbnailUrl) => {
            setAlbums((prev) =>
              prev.map((a) => (a.id === albumId ? { ...a, cover_thumbnail_url: thumbnailUrl } : a))
            )
          }}
          onMetadataUpdated={(updates) => {
            setImages((prev) =>
              prev.map((img) => (img.id === updates.id ? { ...img, ...updates } : img))
            )
          }}
        />
      )}
    </div>
  )
}
