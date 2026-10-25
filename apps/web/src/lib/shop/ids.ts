import { randomBytes } from "node:crypto";

/** Short, URL-safe, prefixed ids ("st_8fK2…") so a stray id says what it points at. */
export const newId = (prefix: "org" | "st" | "cat" | "prd" | "pol" | "kyc") => `${prefix}_${randomBytes(9).toString("base64url")}`;

/** "Sharma Electronics & Co." → "sharma-electronics-co" */
export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "store"
  );
}
