'use client'

import { useState } from 'react'

type Mode = 'import' | 'reference'

type Result =
  | { mode: 'reference'; id: string }
  | { mode: 'import'; id: string; publicUrl: string; thumbnailUrl: string }

const MODES: { value: Mode; label: string; description: string }[] = [
  {
    value: 'import',
    label: 'Import — copy to my archive',
    description:
      'Download the image now and save it permanently to Cloudflare R2. Works even after the original URL disappears. Slower (server fetches and re-uploads).',
  },
  {
    value: 'reference',
    label: 'Reference — keep the link',
    description:
      'Store only the URL. Display the image directly from the source. Fast, zero storage used — but the image disappears from your archive if the original link dies.',
  },
]

export function AddFromLinkForm() {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<Mode>('import')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  const isDrive = url.includes('drive.google.com')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setStatus('loading')
    setError('')
    setResult(null)

    try {
      const res = await fetch('/api/images/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, mode }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setResult(json as Result)
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
  }

  function reset() {
    setUrl('')
    setMode('import')
    setStatus('idle')
    setError('')
    setResult(null)
  }

  if (status === 'done' && result) {
    return (
      <div className="space-y-4 rounded-xl border border-border p-6">
        <p className="font-medium">
          {result.mode === 'import'
            ? 'Imported — image saved permanently to your archive.'
            : 'Referenced — URL stored. Image displays from original source.'}
        </p>

        {result.mode === 'import' && (
          <img
            src={result.thumbnailUrl}
            alt="Imported"
            className="max-h-48 rounded-lg object-contain"
          />
        )}

        <button
          onClick={reset}
          className="text-sm text-primary underline underline-offset-4"
        >
          Add another
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* URL input */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Image URL</label>
        <input
          type="url"
          required
          placeholder="https://example.com/photo.jpg"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={status === 'loading'}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
      </div>

      {/* Google Drive notice */}
      {isDrive && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="font-medium">Google Drive link detected</p>
          <p className="mt-1 text-xs">
            Only files shared as <strong>"Anyone with the link"</strong> work. Private files will
            fail — Google returns a login page instead of the image. Large files (&gt;100 MB) are
            also not supported.
          </p>
        </div>
      )}

      {/* Mode selection */}
      <div className="space-y-2">
        <p className="text-sm font-medium">How to store this image</p>
        {MODES.map(({ value, label, description }) => (
          <label
            key={value}
            className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${
              mode === value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-accent/30'
            }`}
          >
            <input
              type="radio"
              name="mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
              className="mt-0.5 accent-primary"
            />
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Error */}
      {status === 'error' && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'loading' || !url.trim()}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {status === 'loading'
          ? mode === 'import'
            ? 'Fetching and importing…'
            : 'Validating URL…'
          : mode === 'import'
          ? 'Import to archive'
          : 'Save reference'}
      </button>
    </form>
  )
}
