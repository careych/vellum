import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

export default async function ExportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Export catalog</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Download your entire photo catalog as structured data. You can use this to
          rebuild the archive on any platform — you are never locked in.
        </p>
      </div>

      <div className="rounded-xl border border-border p-6 space-y-4">
        <ExportButton format="json" label="Download JSON" description="Full catalog: albums, tags, and all image metadata with URLs. Machine-readable, easy to import into other tools." />
        <ExportButton format="csv" label="Download CSV" description="Flat spreadsheet: one image per row, columns for all fields. Open in Excel, Google Sheets, or any data tool." />
      </div>

      <div className="rounded-xl border border-border p-6 space-y-3 text-sm">
        <p className="font-medium">What is included</p>
        <ul className="space-y-1 text-muted-foreground list-disc list-inside">
          <li>Every image row: name, note, dates, dimensions, file size, MIME type</li>
          <li>R2 object keys + public URLs for originals and thumbnails</li>
          <li>Album membership and album names</li>
          <li>All tags per image</li>
          <li>Source type (upload vs external reference)</li>
        </ul>
        <p className="text-muted-foreground pt-1">
          R2 objects (the actual image files) are <strong>not</strong> downloaded here —
          use the backup script in <code className="font-mono text-xs bg-muted px-1 rounded">scripts/backup.ts</code> for
          a full object listing. To download the files themselves, use{' '}
          <code className="font-mono text-xs bg-muted px-1 rounded">rclone</code> against your R2 bucket.
        </p>
      </div>
    </div>
  )
}

function ExportButton({
  format,
  label,
  description,
}: {
  format: 'json' | 'csv'
  label: string
  description: string
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <a
        href={`/api/admin/export?format=${format}`}
        download
        className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        {label}
      </a>
    </div>
  )
}
