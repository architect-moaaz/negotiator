import { NextResponse, type NextRequest } from "next/server";

/**
 * Development only: lets the Expo web preview (MOBILE_DEV_ORIGIN, e.g. http://localhost:8081) call the
 * API with the app's session headers. Native apps don't need CORS, and production never answers it.
 */
export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = process.env.NODE_ENV === "development" && process.env.MOBILE_DEV_ORIGIN && origin === process.env.MOBILE_DEV_ORIGIN;
  if (!allowed) return NextResponse.next();
  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-gc-buyer, x-gc-member",
    Vary: "Origin",
  };
  if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: cors });
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: ["/api/:path*"] };
