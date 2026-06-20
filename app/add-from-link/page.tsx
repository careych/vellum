import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { AddFromLinkForm } from './_add-form'

export default async function AddFromLinkPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add from link</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add an image by URL — as a permanent import or a live reference.
        </p>
      </div>
      <AddFromLinkForm />
    </div>
  )
}
