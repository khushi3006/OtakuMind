import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyJWT } from './lib/jwt';

const COOKIE_NAME = 'session';

// Define public and protected route lists
const PROTECTED_PAGES = ['/', '/airing-schedule', '/original-list', '/users'];
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

  // 2. Protect pages (e.g. /, /airing-schedule, /original-list)
  const isPageProtected = PROTECTED_PAGES.some(page => pathname === page || (page !== '/' && pathname.startsWith(page)));
  
  if (isPageProtected && !session) {
    // Redirect to login page and preserve original destination via query param
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 3. Protect API routes (except auth endpoints and server-to-server billing webhooks,
  //    which authenticate via their own provider secret rather than a session cookie).
  const isBillingWebhook =
    pathname.startsWith('/api/billing/razorpay/webhook') ||
    pathname.startsWith('/api/billing/revenuecat-webhook');
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/') && !isBillingWebhook) {
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
