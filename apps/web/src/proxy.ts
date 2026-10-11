import { NextResponse, type NextRequest } from 'next/server';
import { geoOverride } from '@/lib/geo';

/** Stamps DEV_COUNTRY onto requests (pages + the /v1 rewrite to the API). No-op in production. */
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  for (const [k, v] of Object.entries(geoOverride(req.headers))) headers.set(k, v);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/((?!_next/|favicon.ico).*)'] };
