'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type AuthState = { error: string } | undefined

export async function login(state: AuthState, formData: FormData): Promise<AuthState> {
  const email = (formData.get('email') as string).trim().toLowerCase()
  const password = formData.get('password') as string

  // Defense in depth: reject emails that don't match the configured admin address.
  // Supabase's "disable signups" setting is the primary guard; this is the second.
  // Return the same message for wrong-email and wrong-password to prevent enumeration.
  if (email !== process.env.ADMIN_EMAIL?.toLowerCase()) {
    return { error: 'Invalid credentials' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: 'Invalid credentials' }
  }

  redirect('/')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}
