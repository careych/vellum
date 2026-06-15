'use client'

import { useState } from 'react'

type State =
  | { status: 'idle' }
  | { status: 'uploading'; step: string }
  | { status: 'done'; publicUrl: string; key: string; sizeKB: number }
  | { status: 'error'; message: string }

export function UploadTestForm() {
  const [state, setState] = useState<State>({ status: 'idle' })

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const file = (
      e.currentTarget.elements.namedItem('file') as HTMLInputElement
    ).files?.[0]
    if (!file) return

    setState({ status: 'uploading', step: 'Getting presigned URL from server…' })

    try {
      // Step 1 — ask our API for a presigned PUT URL
      const res = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? `Server error ${res.status}`)
      }

      const { presignedUrl, key, publicUrl } = (await res.json()) as {
        presignedUrl: string
        key: string
        publicUrl: string
      }

      setState({ status: 'uploading', step: 'Uploading directly to R2…' })

      // Step 2 — PUT the raw file bytes straight to R2 (no Vercel in the middle)
      const upload = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })

      if (!upload.ok) {
        throw new Error(`R2 rejected the upload: ${upload.status} ${upload.statusText}`)
      }

      setState({
        status: 'done',
        publicUrl,
        key,
        sizeKB: Math.round(file.size / 1024),
      })
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="file" className="text-sm font-medium">
          Image file
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept="image/*"
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={state.status === 'uploading'}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {state.status === 'uploading' ? state.step : 'Upload to R2'}
      </button>

      {state.status === 'done' && (
        <div className="space-y-3 rounded-md border border-border p-4 text-sm">
          <p className="font-semibold">
            Uploaded {state.sizeKB} KB — original quality, zero processing.
          </p>
          <p className="break-all text-muted-foreground">
            <span className="font-medium text-foreground">Key:</span> {state.key}
          </p>
          <a
            href={state.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block break-all text-primary underline underline-offset-4"
          >
            View permanent public URL →
          </a>
          <img
            src={state.publicUrl}
            alt="Uploaded preview"
            className="mt-2 max-h-64 w-full rounded-md object-contain"
          />
        </div>
      )}

      {state.status === 'error' && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}
    </form>
  )
}
