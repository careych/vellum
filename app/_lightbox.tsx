'use client'

import { useEffect, useState, useTransition } from 'react'

import { updateAlbum } from '@/app/actions/albums'
import { deleteImage, updateImageMetadata } from '@/app/actions/images'
import type { Album, ImageDetail, ImageItem } from '@/lib/types'

export function Lightbox({
  imageId,
  isAdmin,
  albums,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onDelete,
  onSetCover,
  onMetadataUpdated,
}: {
  imageId: string
  isAdmin: boolean
  albums: Album[]
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onDelete: (id: string) => void
  onSetCover: (albumId: string, thumbnailUrl: string | null) => void
  onMetadataUpdated: (updates: Partial<ImageItem> & { id: string }) => void
}) {
  const [detail, setDetail] = useState<ImageDetail | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [editing, setEditing] = useState(false)

  // Edit form fields
  const [editName, setEditName] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editAlbumId, setEditAlbumId] = useState('')
  const [editTags, setEditTags] = useState('')
  const [editTakenAt, setEditTakenAt] = useState('')

  const [saving, startSave] = useTransition()
  const [deleting, startDelete] = useTransition()
  const [settingCover, startCover] = useTransition()

  // Fetch detail whenever imageId changes
  useEffect(() => {
    setDetail(null)
    setLoadError(false)
    setEditing(false)

    fetch(`/api/images/${imageId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: ImageDetail) => {
        setDetail(d)
        setEditName(d.name ?? '')
        setEditNote(d.note ?? '')
        setEditAlbumId(d.album_id ?? '')
        setEditTags(d.tags.join(', '))
        setEditTakenAt(d.taken_at ? d.taken_at.substring(0, 10) : '')
      })
      .catch(() => setLoadError(true))
  }, [imageId])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  function handleSave() {
    if (!detail || saving) return
    const tags = editTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    startSave(async () => {
      await updateImageMetadata(detail.id, {
        name: editName,
        note: editNote,
        albumId: editAlbumId || null,
        tags,
        takenAt: editTakenAt || null,
      })
      const updated: ImageDetail = {
        ...detail,
        name: editName || null,
        note: editNote || null,
        album_id: editAlbumId || null,
        album_name: albums.find((a) => a.id === editAlbumId)?.name ?? null,
        tags,
        taken_at: editTakenAt || null,
      }
      setDetail(updated)
      onMetadataUpdated({
        id: detail.id,
        name: updated.name,
        taken_at: updated.taken_at,
        album_id: updated.album_id,
        album_name: updated.album_name,
      })
      setEditing(false)
    })
  }

  function handleDelete() {
    if (!detail || deleting) return
    if (!confirm('Permanently delete this photo from R2 and the database?')) return
    startDelete(async () => {
      await deleteImage(detail.id)
      onDelete(detail.id)
    })
  }

  function handleSetCover() {
    if (!detail?.album_id || settingCover) return
    const albumId = detail.album_id
    const thumbnailUrl = detail.thumbnail_url
    startCover(async () => {
      await updateAlbum(albumId, { cover_image_id: detail.id })
      onSetCover(albumId, thumbnailUrl)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/90"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Image area */}
      <div className="flex-1 flex items-center justify-center relative min-w-0">
        {/* Prev */}
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          className="absolute left-3 z-10 w-10 h-10 flex items-center justify-center rounded-full text-white text-xl bg-black/30 hover:bg-black/60 disabled:opacity-20 transition-colors"
          aria-label="Previous"
        >
          ‹
        </button>

        {/* Image */}
        {!detail && !loadError && (
          <div className="w-10 h-10 border-2 border-white/40 border-t-white rounded-full animate-spin" />
        )}
        {loadError && <p className="text-white/50 text-sm">Failed to load</p>}
        {detail?.original_url && (
          <img
            key={detail.original_url}
            src={detail.original_url}
            alt={detail.name ?? ''}
            className="max-w-full max-h-screen object-contain p-8"
          />
        )}

        {/* Next */}
        <button
          onClick={onNext}
          disabled={!hasNext}
          className="absolute right-3 z-10 w-10 h-10 flex items-center justify-center rounded-full text-white text-xl bg-black/30 hover:bg-black/60 disabled:opacity-20 transition-colors"
          aria-label="Next"
        >
          ›
        </button>
      </div>

      {/* Info panel */}
      <div className="w-72 shrink-0 bg-background flex flex-col overflow-hidden border-l border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <p className="text-sm font-medium truncate pr-2">
            {detail?.name ?? (detail ? 'Untitled' : '…')}
          </p>
          <button
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-foreground p-1 rounded"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          {detail && !editing && (
            <>
              {detail.note && (
                <Field label="Note">
                  <p className="whitespace-pre-wrap">{detail.note}</p>
                </Field>
              )}
              {detail.taken_at && (
                <Field label="Date taken">
                  {new Date(detail.taken_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Field>
              )}
              {detail.album_name && <Field label="Album">{detail.album_name}</Field>}
              {detail.tags.length > 0 && (
                <Field label="Tags">
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {detail.tags.map((t) => (
                      <span
                        key={t}
                        className="text-xs bg-secondary px-2 py-0.5 rounded-full text-secondary-foreground"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </Field>
              )}
              <Field label="Uploaded">
                {new Date(detail.uploaded_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </Field>
              {detail.file_size != null && (
                <Field label="File size">
                  {(detail.file_size / 1024 / 1024).toFixed(2)} MB
                </Field>
              )}
              {detail.width != null && detail.height != null && (
                <Field label="Dimensions">
                  {detail.width} × {detail.height}
                </Field>
              )}
              {detail.mime_type && <Field label="Type">{detail.mime_type}</Field>}
              {detail.original_url && (
                <a
                  href={detail.original_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-primary hover:underline mt-2"
                >
                  Open original ↗
                </a>
              )}
            </>
          )}

          {detail && editing && (
            <div className="space-y-3">
              <FormField label="Name">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
                />
              </FormField>
              <FormField label="Note">
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  rows={3}
                  className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </FormField>
              <FormField label="Album">
                <select
                  value={editAlbumId}
                  onChange={(e) => setEditAlbumId(e.target.value)}
                  className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">— no album —</option>
                  {albums.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Tags (comma-separated)">
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="vacation, family, 2024"
                  className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
                />
              </FormField>
              <FormField label="Date taken">
                <input
                  type="date"
                  value={editTakenAt}
                  onChange={(e) => setEditTakenAt(e.target.value)}
                  className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
                />
              </FormField>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 text-sm py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="flex-1 text-sm py-1.5 border border-border rounded hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Admin actions */}
        {isAdmin && detail && !editing && (
          <div className="border-t border-border p-4 space-y-2 shrink-0">
            <button
              onClick={() => setEditing(true)}
              className="w-full text-sm py-1.5 border border-border rounded hover:bg-accent transition-colors"
            >
              Edit metadata
            </button>
            {detail.album_id && (
              <button
                onClick={handleSetCover}
                disabled={settingCover}
                className="w-full text-sm py-1.5 border border-border rounded hover:bg-accent transition-colors disabled:opacity-50"
              >
                {settingCover ? 'Setting…' : 'Set as album cover'}
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="w-full text-sm py-1.5 bg-destructive/10 text-destructive rounded hover:bg-destructive/20 transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete photo'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1">{label}</label>
      {children}
    </div>
  )
}
