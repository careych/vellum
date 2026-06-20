import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { UploadZone } from './_upload-zone'

export default async function UploadPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: albums }, { data: tags }] = await Promise.all([
    supabase.from('albums').select('id, name').order('name'),
    supabase.from('tags').select('id, name').order('name'),
  ])

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload Photos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Originals stored losslessly. Thumbnails generated client-side.
        </p>
      </div>
      <UploadZone albums={albums ?? []} existingTags={tags ?? []} />
    </div>
  )
}
