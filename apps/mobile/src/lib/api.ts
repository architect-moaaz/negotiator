/**
 * The GhostCart API, as the app sees it. Sessions travel in x-gc-buyer / x-gc-member headers (the
 * server accepts them like its cookies). EXPO_PUBLIC_API_URL picks the deployment.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://ghostcart.app").replace(/\/$/, "");

export interface Tokens {
  buyer?: string;
  member?: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export function sessionHeaders(tokens: Tokens): Record<string, string> {
  const h: Record<string, string> = {};
  if (tokens.buyer) h["x-gc-buyer"] = tokens.buyer;
  if (tokens.member) h["x-gc-member"] = tokens.member;
  return h;
}

export async function request<T>(tokens: Tokens, path: string, init: { method?: string; body?: unknown } = {}, fetcher: typeof fetch = fetch): Promise<Result<T>> {
  try {
    const res = await fetcher(`${API_URL}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { Accept: "application/json", ...(init.body !== undefined && { "Content-Type": "application/json" }), ...sessionHeaders(tokens) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: (data as { error?: string }).error ?? "Something went wrong. Try again." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "No connection. Check your internet and try again." };
  }
}
