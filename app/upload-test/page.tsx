import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { UploadTestForm } from './_upload-form'

// Dev tool — proves the R2 presigned upload pipeline works end-to-end.
// Remove this route once Phase 5 (real upload UI) is complete.
export default async function UploadTestPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">R2 Upload Test</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick any image — it will be sent directly to Cloudflare R2 via a
          presigned URL (bypasses Vercel entirely).
        </p>
      </div>
      <UploadTestForm />
    </div>
  )
}
