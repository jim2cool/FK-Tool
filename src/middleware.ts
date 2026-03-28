import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { hasPageAccess, pageSlugFromPath, pageForApiRoute } from '@/lib/auth/page-access'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isAuthRoute = pathname.startsWith('/login')
  const isSetupRoute = pathname === '/setup'
  const isApiRoute = pathname.startsWith('/api')

  if (!user && !isAuthRoute && !isApiRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, allowed_pages')
      .eq('id', user.id)
      .single()

    if (!profile && !isSetupRoute && !isAuthRoute && !isApiRoute) {
      return NextResponse.redirect(new URL('/setup', request.url))
    }

    // ── Page-level access enforcement ─────────────────────────────────────
    if (profile) {
      const allowedPages: string[] | null = profile.allowed_pages

      if (!isAuthRoute && !isSetupRoute) {
        if (isApiRoute) {
          // API routes: check page ownership, return 403 if forbidden
          const page = pageForApiRoute(pathname)
          if (page && !hasPageAccess(allowedPages, page)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }
        } else {
          // Page routes: redirect to dashboard if not allowed
          const page = pageSlugFromPath(pathname)
          if (page && !hasPageAccess(allowedPages, page)) {
            return NextResponse.redirect(new URL('/dashboard', request.url))
          }
        }
      }
    }
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
