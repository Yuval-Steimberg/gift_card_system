import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Refreshes the Supabase auth session cookie on navigation so Server Components
 * always read a fresh token (they can't write cookies themselves). No-op when
 * Supabase isn't configured (demo auth path). Only runs on app routes — static
 * assets and the health endpoint are excluded by the matcher below.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.next()

  const response = NextResponse.next({ request })
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => {
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  // Touch the session so an expired access token is refreshed into the response.
  await supabase.auth.getUser()
  return response
}

export const config = {
  matcher: [
    // Run on employee/admin areas (auth-gated) — skip static + api + assets.
    '/employee/:path*',
    '/admin/:path*',
  ],
}
