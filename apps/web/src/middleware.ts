import { NextResponse, type NextRequest } from 'next/server';

/**
 * Defence in depth for credential pages. The forms declare method="post" (so a native submission before the client has
 * hydrated puts nothing in the URL, history or Referer) and keep their button disabled until hydrated. If a native POST
 * still arrives, it is answered with a 303 back to the same page: the body is never read, stored or forwarded, and
 * the browser re-requests the page with GET. Credentials only ever travel through the JSON API call made by the client.
 */
export function middleware(req: NextRequest) {
  if (req.method === 'POST' && !req.headers.get('next-action')) {
    return NextResponse.redirect(new URL(req.nextUrl.pathname + req.nextUrl.search, req.url), 303);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/login', '/forgot-password', '/reset-password', '/accept-invite'] };
