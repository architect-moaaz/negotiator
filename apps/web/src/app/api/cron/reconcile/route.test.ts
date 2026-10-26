import { schema } from "@ghostcart/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { GET } from "./route";

const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage: (...a: unknown[]) => captureMessage(...a) }));

const call = () => GET(new Request("http://localhost/api/cron/reconcile", { headers: { authorization: "Bearer zz-cron-secret" } }));

describe("nightly reconcile cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "zz-cron-secret";
    captureMessage.mockClear();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("refuses calls without the cron secret", async () => {
    expect((await GET(new Request("http://localhost/api/cron/reconcile"))).status).toBe(401);
  });

  it("runs the ledger gate, and reports to Sentry only when it fails", async () => {
    const ok = await (await call()).json();
    expect(ok.ledger).toMatchObject({ ok: true, problems: 0 });
    expect(captureMessage).not.toHaveBeenCalled();

    await (await getDb()).insert(schema.ledgerEntries).values({ txnId: "txn_zz_cron_bad", kind: "adjustment", account: "ghostcart:fee", amount: 3 });
    const bad = await (await call()).json();
    expect(bad.ledger.ok).toBe(false);
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("Ledger gate failed"), expect.objectContaining({ level: "error" }));
  });
});
