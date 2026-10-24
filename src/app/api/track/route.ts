import { cookies } from "next/headers";
import { demographicsFrom } from "@/lib/demographics";
import { store } from "@/lib/store";

const VISITOR_COOKIE = "gc_vid";

/** Anonymous page-view beacon: an opaque visitor id plus coarse device/geo/source, no personal data. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { path?: string; referrer?: string; source?: string };
  const path = (body.path ?? "/").slice(0, 80);
  if (!/^\/[\w\-/]*$/.test(path)) return new Response(null, { status: 204 });

  const jar = await cookies();
  let vid = jar.get(VISITOR_COOKIE)?.value;
  if (!vid) {
    vid = crypto.randomUUID();
    jar.set(VISITOR_COOKIE, vid, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 180, path: "/" });
  }
  // Collapse per-deal paths so analytics groups them.
  const page = path.replace(/^\/deal\/[\w-]+$/, "/deal/[id]").replace(/^\/pay\/mock\/.+$/, "/pay/[order]");
  await store.pushVisit({ vid, path: page, at: Date.now(), ...demographicsFrom(request, { referrer: body.referrer, source: body.source }) });
  return new Response(null, { status: 204 });
}
