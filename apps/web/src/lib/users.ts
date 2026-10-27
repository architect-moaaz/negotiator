import { DEAL_CONTACT_WORDING, recordConsent } from "./privacy/consent";
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

export async function signUp(input: {
  name: string;
  phone: string;
  email?: string;
  channel: Channel;
  city?: string;
  consent: boolean;
  /** The consent sentence as the shopper saw it (another language); defaults to DEAL_CONTACT_WORDING. */
  consentWording?: string;
  demographics?: Demographics;
  source?: string;
  /** From an invite link: credited to its owner only if this is a new account. */
  inviteCode?: string;
}) {
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
  if (created && input.inviteCode) await (await import("./referrals")).recordReferral(input.inviteCode, user.id);
  // Every tick of the box is recorded, including on sign-back-in: it renews consent the person may have withdrawn.
  if (input.consent) {
    await recordConsent(user.id, "deal_contact", "granted", input.consentWording ?? DEAL_CONTACT_WORDING, `signup:${input.source ?? input.channel}`);
    if (!user.consentAt) await store.updateUser({ ...user, consentAt: Date.now() });
  }
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
