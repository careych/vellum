import { LoginForm } from './_login-form'

export default function LoginPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This vault is read-only for visitors.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
