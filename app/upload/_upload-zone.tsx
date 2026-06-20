'use client'

import { useRef, useState, useTransition } from 'react'
import { parse as parseExif } from 'exifr'

import { updateImageMetadata } from '@/app/actions/images'

// ─── Types ───────────────────────────────────────────────────────────────────

type Phase =
  | 'queued'
  | 'reading'
  | 'uploading-original'
  | 'uploading-thumbnail'
  | 'saving'
  | 'done'
  | 'error'

type QueueItem = {
  id: string
  file: File
  phase: Phase
  error?: string
  previewUrl?: string
  width?: number
  height?: number
  takenAt?: string | null
  imageId?: string
  thumbnailUrl?: string
}

type Album = { id: string; name: string }
type Tag = { id: string; name: string }

interface Props {
  albums: Album[]
  existingTags: Tag[]
}

// ─── Module-level helpers (no component state needed) ────────────────────────

function readDimensions(
  file: File
): Promise<{ width: number; height: number; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight, previewUrl: url })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Cannot decode image — format may be unsupported in this browser'))
    }
    img.src = url
  })
}

async function makeThumb(previewUrl: string, maxEdge = 400): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = previewUrl
  })
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
      'image/jpeg',
      0.82
    )
  })
}

async function presignRequest(
  fileName: string,
  contentType: string,
  fileSize: number,
  prefix: 'originals' | 'thumbnails'
): Promise<{ presignedUrl: string; key: string; publicUrl: string }> {
  const res = await fetch('/api/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, contentType, fileSize, prefix }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Presign failed (${res.status})`)
  }
  return res.json()
}

async function putToR2(url: string, body: File | Blob, contentType: string): Promise<void> {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body })
  if (!res.ok) throw new Error(`R2 upload failed (${res.status} ${res.statusText})`)
}

const PHASE_LABEL: Record<Phase, string> = {
  queued: 'Queued',
  reading: 'Reading…',
  'uploading-original': 'Uploading original…',
  'uploading-thumbnail': 'Uploading thumbnail…',
  saving: 'Saving to library…',
  done: 'Done',
  error: 'Failed',
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UploadZone({ albums, existingTags }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  // Per-image editable metadata (keyed by imageId)
  const [names, setNames] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  // Shared metadata for the whole batch
  const [globalAlbum, setGlobalAlbum] = useState('')
  const [globalTags, setGlobalTags] = useState('')
  const [metaSaved, setMetaSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  // ── State helpers ──────────────────────────────────────────────────────────

  function patchItem(id: string, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  // ── Upload pipeline ────────────────────────────────────────────────────────

  async function runPipeline(item: QueueItem) {
    const { id, file } = item

    try {
      // 1 · Read EXIF + dimensions
      patchItem(id, { phase: 'reading' })

      let takenAt: string | null = null
      try {
        const exif = await parseExif(file, { pick: ['DateTimeOriginal'] })
        if (exif?.DateTimeOriginal instanceof Date) {
          takenAt = exif.DateTimeOriginal.toISOString()
        }
      } catch {
        // No EXIF or unsupported format — takenAt stays null
      }

      const { width, height, previewUrl } = await readDimensions(file)
      patchItem(id, { width, height, previewUrl, takenAt })

      // 2 · Generate thumbnail (best-effort; HEIC on Chrome may fail)
      let thumbBlob: Blob | null = null
      try {
        thumbBlob = await makeThumb(previewUrl)
      } catch {
        // Non-fatal: image goes to archive without a thumbnail
      }

      // 3 · Upload original to R2 (lossless, untouched bytes)
      patchItem(id, { phase: 'uploading-original' })
      const orig = await presignRequest(file.name, file.type, file.size, 'originals')
      await putToR2(orig.presignedUrl, file, file.type)

      // 4 · Upload thumbnail to R2
      let thumbnailKey: string | null = null
      let thumbnailUrl: string | null = null
      if (thumbBlob) {
        patchItem(id, { phase: 'uploading-thumbnail' })
        const thumb = await presignRequest('thumb.jpg', 'image/jpeg', thumbBlob.size, 'thumbnails')
        await putToR2(thumb.presignedUrl, thumbBlob, 'image/jpeg')
        thumbnailKey = thumb.key
        thumbnailUrl = thumb.publicUrl
      }

      // 5 · Insert DB row (server deletes R2 objects if this fails)
      patchItem(id, { phase: 'saving' })
      const dbRes = await fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          r2_object_key: orig.key,
          thumbnail_key: thumbnailKey,
          width,
          height,
          file_size: file.size,
          mime_type: file.type,
          taken_at: takenAt,
        }),
      })

      if (!dbRes.ok) {
        const body = await dbRes.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to save to database')
      }

      const { id: imageId } = (await dbRes.json()) as { id: string }
      patchItem(id, { phase: 'done', imageId, thumbnailUrl: thumbnailUrl ?? undefined })
    } catch (err) {
      patchItem(id, {
        phase: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
      })
    }
  }

  // ── File intake ────────────────────────────────────────────────────────────

  function addFiles(files: FileList | File[]) {
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (!images.length) return
    const items: QueueItem[] = images.map((file) => ({
      id: crypto.randomUUID(),
      file,
      phase: 'queued' as const,
    }))
    setQueue((prev) => [...prev, ...items])
    for (const item of items) runPipeline(item)
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current++
    setIsDragging(true)
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    if (--dragCounter.current === 0) setIsDragging(false)
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragging(false)
    addFiles(e.dataTransfer.files)
  }

  // ── Metadata save ──────────────────────────────────────────────────────────

  function handleSave() {
    setSaveError(null)
    startTransition(async () => {
      try {
        const tags = globalTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)

        await Promise.all(
          doneItems.map((item) =>
            updateImageMetadata(item.imageId!, {
              name: names[item.imageId!] ?? item.file.name.replace(/\.[^.]+$/, ''),
              note: notes[item.imageId!] ?? '',
              albumId: globalAlbum || null,
              tags,
            })
          )
        )
        setMetaSaved(true)
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save metadata')
      }
    })
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const allTerminal =
    queue.length > 0 && queue.every((q) => q.phase === 'done' || q.phase === 'error')
  const doneItems = queue.filter((q) => q.phase === 'done' && q.imageId)
  const showDropZone = !allTerminal
  const showMeta = allTerminal && doneItems.length > 0 && !metaSaved

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      {showDropZone && (
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-14 text-center transition-colors select-none ${
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-accent/30'
          }`}
        >
          <p className="text-sm font-medium">Drop photos here</p>
          <p className="mt-1 text-xs text-muted-foreground">
            or tap to browse&nbsp;·&nbsp;mobile camera / gallery supported
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </div>
      )}

      {/* Queue */}
      {queue.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {queue.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              {/* Thumbnail preview */}
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                {item.previewUrl && (
                  <img
                    src={item.previewUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>

              {/* File info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(item.file.size / 1024 / 1024).toFixed(1)} MB
                  {item.width ? ` · ${item.width}×${item.height}` : ''}
                </p>
              </div>

              {/* Status */}
              <div className="flex items-center gap-2 text-right">
                {item.phase === 'done' && (
                  <span className="text-xs font-medium text-green-600 dark:text-green-400">
                    Done
                  </span>
                )}
                {item.phase === 'error' && (
                  <div className="flex items-center gap-2">
                    <span
                      className="max-w-[180px] truncate text-xs text-destructive"
                      title={item.error}
                    >
                      {item.error}
                    </span>
                    <button
                      onClick={() => {
                        patchItem(item.id, { phase: 'queued', error: undefined })
                        runPipeline({ ...item, phase: 'queued', error: undefined })
                      }}
                      className="text-xs underline underline-offset-2"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {item.phase !== 'done' && item.phase !== 'error' && (
                  <span className="text-xs text-muted-foreground">
                    {PHASE_LABEL[item.phase]}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Metadata form — shown when all uploads are terminal */}
      {showMeta && (
        <div className="space-y-6 rounded-xl border border-border p-6">
          <h2 className="text-base font-semibold">Set metadata</h2>

          {/* Per-image: name + note */}
          <div className="space-y-4">
            {doneItems.map((item) => {
              const defaultName = item.file.name.replace(/\.[^.]+$/, '')
              return (
                <div key={item.imageId} className="flex gap-3">
                  {/* Thumbnail */}
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {(item.thumbnailUrl ?? item.previewUrl) && (
                      <img
                        src={item.thumbnailUrl ?? item.previewUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>

                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      placeholder="Name (optional)"
                      value={names[item.imageId!] ?? defaultName}
                      onChange={(e) =>
                        setNames((prev) => ({ ...prev, [item.imageId!]: e.target.value }))
                      }
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                      type="text"
                      placeholder="Note (optional)"
                      value={notes[item.imageId!] ?? ''}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [item.imageId!]: e.target.value }))
                      }
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Album */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Album</label>
            <select
              value={globalAlbum}
              onChange={(e) => setGlobalAlbum(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">No album</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tags</label>
            <input
              type="text"
              placeholder="family, vacation, 2024  (comma-separated)"
              value={globalTags}
              onChange={(e) => setGlobalTags(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {existingTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {existingTags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setGlobalTags((prev) => {
                        const parts = prev.split(',').map((s) => s.trim()).filter(Boolean)
                        return parts.includes(t.name) ? prev : [...parts, t.name].join(', ')
                      })
                    }
                    className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-accent"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {saveError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {saveError}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={isPending}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? 'Saving…' : `Save ${doneItems.length} photo${doneItems.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Success */}
      {metaSaved && (
        <div className="rounded-xl border border-border bg-accent/20 p-6 text-center space-y-3">
          <p className="font-medium">
            {doneItems.length} photo{doneItems.length !== 1 ? 's' : ''} added to your archive.
          </p>
          <button
            onClick={() => {
              setQueue([])
              setNames({})
              setNotes({})
              setGlobalAlbum('')
              setGlobalTags('')
              setMetaSaved(false)
              setSaveError(null)
            }}
            className="text-sm text-primary underline underline-offset-4"
          >
            Upload more
          </button>
        </div>
      )}
    </div>
  )
}
