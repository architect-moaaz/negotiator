import { cookies } from "next/headers";
import { demographicsFrom } from "@/lib/demographics";
import { store } from "@/lib/store";
import { currentUser, normalizePhone, publicUser, SESSION_COOKIE, signUp } from "@/lib/users";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    phone?: string;
    email?: string;
    consent?: boolean;
    referrer?: string;
    source?: string;
  };
  const name = body.name?.trim();
  const phone = body.phone ? normalizePhone(body.phone) : null;
  if (!name) return Response.json({ error: "Enter your name." }, { status: 400 });
  if (!phone) return Response.json({ error: "Enter a 10-digit Indian mobile number." }, { status: 400 });
  if (body.consent !== true) return Response.json({ error: "Tick the box to agree to be contacted about your deal." }, { status: 400 });
  if (body.email && !/^\S+@\S+\.\S+$/.test(body.email)) return Response.json({ error: "That email doesn't look right." }, { status: 400 });

  // An existing number must prove it's theirs with a login code; no silent account takeover.
  const existingId = await store.userIdForPhone(phone);
  if (existingId && (await currentUser())?.id !== existingId) {
    return Response.json({ error: "This number already has a GhostCart account. Log in with a code instead.", needsLogin: true }, { status: 409 });
  }

  const demographics = demographicsFrom(request, { referrer: body.referrer, source: body.source });
  const user = await signUp({ name, phone, email: body.email, channel: "web", city: demographics.city, consent: true, demographics });
  (await cookies()).set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return Response.json(publicUser(user));
}
