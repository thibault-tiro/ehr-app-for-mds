import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { appConfig } from '@/app.config'
import '@/styles.css'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
})

function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        This address does not exist in {appConfig.name}.{' '}
        <Link to="/" className="underline">
          Go to the home page
        </Link>
        .
      </p>
    </div>
  )
}

function RootLayout() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="shrink-0 border-b">
        <nav className="flex items-center justify-between gap-4 px-4 py-2.5">
          <Link to="/" className="font-semibold">
            {appConfig.name}
          </Link>
          <span className="text-xs text-muted-foreground">
            Images stay on this device · not for diagnostic reporting
          </span>
        </nav>
      </header>
      <main className="flex min-h-0 flex-1 flex-col px-4 py-4">
        <Outlet />
      </main>
      {import.meta.env.DEV && (
        <TanStackRouterDevtools position="bottom-right" />
      )}
    </div>
  )
}
