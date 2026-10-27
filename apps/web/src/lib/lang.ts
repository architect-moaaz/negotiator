import { cookies, headers } from "next/headers";
import { LANG_COOKIE, pickLang, type Lang } from "./i18n";

/** The shopper's language for this request (server only). */
export async function getLang(): Promise<Lang> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return pickLang(jar.get(LANG_COOKIE)?.value, h.get("accept-language"));
}
