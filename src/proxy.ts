import { NextResponse, type NextRequest } from "next/server";

/** Without a database configured, send every page to the setup screen. */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (configured || path.startsWith("/setup") || path.startsWith("/legal") || path.startsWith("/api/")) return NextResponse.next();
  return NextResponse.redirect(new URL("/setup", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
