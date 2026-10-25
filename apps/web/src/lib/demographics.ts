import type { Demographics } from "./types";

const header = (r: Request, name: string) => {
  const v = r.headers.get(name);
  return v ? decodeURIComponent(v) : undefined;
};

function parseUserAgent(ua: string): Pick<Demographics, "device" | "os" | "browser"> {
  const device = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua) ? "tablet" : /Mobi|iPhone|Android/i.test(ua) ? "mobile" : "desktop";
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Mac OS X/i.test(ua)
        ? "macOS"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Other";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /CriOS|Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Other";
  return { device, os, browser };
}

/** Demographics from the request (Vercel geo headers, user agent) plus what the page reports. */
export function demographicsFrom(request: Request, client: { referrer?: string; source?: string } = {}): Demographics {
  let referrer: string | undefined;
  try {
    referrer = client.referrer ? new URL(client.referrer).hostname.replace(/^www\./, "") : undefined;
  } catch {}
  const hourIst = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date())) % 24;
  return {
    city: header(request, "x-vercel-ip-city"),
    region: header(request, "x-vercel-ip-country-region"),
    country: header(request, "x-vercel-ip-country"),
    ...parseUserAgent(request.headers.get("user-agent") ?? ""),
    language: request.headers.get("accept-language")?.split(",")[0]?.trim() || undefined,
    referrer,
    source: client.source?.slice(0, 40) || undefined,
    hourIst,
  };
}
