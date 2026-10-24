import { timingSafeEqual } from "node:crypto";

/** Bearer-token check for admin and deal-desk endpoints. */
export function isAdmin(request: Request) {
  const token = process.env.ADMIN_TOKEN;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return !!token && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
}
