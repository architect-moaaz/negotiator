import { currentSubject } from "./session";
import { store } from "./store";
import type { Channel, Demographics, User } from "./types";

/** Normalise Indian mobile numbers to E.164; returns null if it doesn't look like one. */
export function normalizePhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

export function maskPhone(phone: string) {
  return phone.replace(/^(\+\d{2})(\d{2})\d{5}(\d{3})$/, "$1 $2xxxxx$3");
}

export async function currentUser() {
  const id = await currentSubject("buyer");
  return id ? store.getUser(id) : undefined;
}

export async function signUp(input: { name: string; phone: string; email?: string; channel: Channel; city?: string; consent: boolean; demographics?: Demographics }) {
  const { user, created } = await store.upsertUser({
    id: crypto.randomUUID(),
    name: input.name.trim().slice(0, 80),
    phone: input.phone,
    email: input.email?.trim().slice(0, 120) || undefined,
    channel: input.channel,
    city: input.city,
    demographics: input.demographics,
    createdAt: Date.now(),
    consentAt: input.consent ? Date.now() : undefined,
  });
  await store.log({
    type: "signup",
    actor: "user",
    userId: user.id,
    detail: created
      ? `${user.name} signed up via ${input.channel}${input.city ? ` from ${input.city}` : ""}${input.consent ? "; consented to deal contact" : ""}`
      : `${user.name} signed back in via ${input.channel}`,
  });
  return user;
}

export function publicUser(user: User) {
  return { id: user.id, name: user.name, phone: maskPhone(user.phone) };
}
