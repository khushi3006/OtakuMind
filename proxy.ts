import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyJWT } from './lib/jwt';

const COOKIE_NAME = 'session';

// Define public and protected route lists.
// `/` and `/users/[username]` are deliberately public: `/` server-renders a
// landing page for anonymous visitors (app/page.tsx branches on session) and
// profile pages server-render a read-only public view (SEO/LLM crawlers don't
// log in). `/users` (discover) is protected exact-only so profile sub-paths
// stay reachable.
const PROTECTED_PREFIXES = ['/airing-schedule', '/original-list'];
const PROTECTED_EXACT = ['/users'];
const AUTH_PAGES = ['/login', '/signup'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Read session cookie
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifyJWT(sessionCookie) : null;

  // 1. If accessing Auth pages (login, signup) and already logged in, redirect to home page
  if (AUTH_PAGES.some(page => pathname.startsWith(page))) {
    if (session) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // 2. Protect pages (e.g. /airing-schedule, /original-list, /users)
  const isPageProtected =
    PROTECTED_PREFIXES.some(page => pathname.startsWith(page)) ||
    PROTECTED_EXACT.includes(pathname);
  
  if (isPageProtected && !session) {
    // Redirect to login page and preserve original destination via query param
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 3. Protect API routes (except auth endpoints and server-to-server callers — billing
  //    webhooks and Vercel cron — which authenticate via their own secret rather than a
  //    session cookie; each of those routes enforces its secret itself).
  const isServerToServer =
    pathname.startsWith('/api/billing/razorpay/webhook') ||
    pathname.startsWith('/api/billing/revenuecat-webhook') ||
    pathname.startsWith('/api/cron/');
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/') && !isServerToServer) {
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in.' },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}

// Config to specify matching paths, ignoring public assets, _next internals, and icons
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - icon.png (app icons)
     * - images/ (public images if any)
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.png|icon.svg|images).*)',
  ],
};
