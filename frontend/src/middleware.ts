import { NextResponse, type NextRequest } from 'next/server';

const HRIS_HOST = 'hris.feraco.co.id';
const RECRUITMENT_HOST = 'recruitment.feraco.co.id';

/**
 * Hostname-aware routing for the public recruitment portal.
 *
 * recruitment.feraco.co.id -> only public /jobs/* pages (everything else
 * redirects back to the HRIS host so dashboard/API never leak out).
 * hris.feraco.co.id      -> full HRIS app, including legacy /jobs URLs.
 */
export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').split(':')[0];
  const { pathname, search } = request.nextUrl;

  if (host === RECRUITMENT_HOST && !pathname.startsWith('/jobs')) {
    return NextResponse.redirect(`https://${HRIS_HOST}${pathname}${search}`);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo\\.webp|frc-recruitment\\.webp|robots\\.txt).*)'
  ]
};
