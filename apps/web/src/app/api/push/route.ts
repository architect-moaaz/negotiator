import { PushError, registerPushToken, unregisterPushToken, type PushActor } from "@/lib/push";
import { currentSubject } from "@/lib/session";

/** Every account signed in on this phone: a seller who also shops gets both kinds of notification. */
async function actors() {
  const out: { type: PushActor; id: string }[] = [];
  for (const type of ["member", "buyer"] as const) {
    const id = await currentSubject(type);
    if (id) out.push({ type, id });
  }
  return out;
}

/** The app registers its Expo push token after sign-in. Body: { token, platform }. */
export async function POST(request: Request) {
  const who = await actors();
  if (!who.length) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { token, platform } = (await request.json().catch(() => ({}))) as { token?: string; platform?: string };
  try {
    for (const a of who) await registerPushToken(a.type, a.id, String(token ?? ""), String(platform ?? ""));
    return Response.json({ ok: true, as: who.map((a) => a.type) });
  } catch (err) {
    if (err instanceof PushError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

/** On sign-out of a role (send only that role's session header). Body: { token }. */
export async function DELETE(request: Request) {
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  if (token) for (const a of await actors()) await unregisterPushToken(a.type, a.id, token);
  return Response.json({ ok: true });
}
