import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `) || d === name);

describe("security headers", () => {
  it("blocks framing, plugins, base hijacking and foreign form posts in production", () => {
    const csp = contentSecurityPolicy(false);
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "upgrade-insecure-requests")).toBeDefined();
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws:");
  });

  it("only allows scripts from us and Meta's SDK", () => {
    const sources = directive(contentSecurityPolicy(false), "script-src")!.split(" ").slice(1);
    expect(sources.filter((s) => s.startsWith("http"))).toEqual(["https://connect.facebook.net"]);
    expect(sources).not.toContain("*");
  });

  it("relaxes only what the dev server needs", () => {
    const csp = contentSecurityPolicy(true);
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toContain("ws:");
    expect(directive(csp, "upgrade-insecure-requests")).toBeUndefined();
    expect(securityHeaders(true).some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  });

  it("sends HSTS, nosniff and a deny frame option in production", () => {
    const h = Object.fromEntries(securityHeaders(false).map(({ key, value }) => [key, value]));
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{8}/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
  });
});
