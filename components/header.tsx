import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/actions/auth'

export async function Header() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <a href="/" className="text-lg font-semibold tracking-tight">
            vellum
          </a>

          {user ? (
            <div className="flex items-center gap-4">
              <a
                href="/upload"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Upload
              </a>
              <a
                href="/add-from-link"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Add link
              </a>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                Admin
              </span>
              <form action={logout}>
                <button
                  type="submit"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <a
              href="/login"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  )
}
