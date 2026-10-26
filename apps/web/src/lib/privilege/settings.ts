import { RECOVERY_DEFAULTS, validateRecovery, type RecoveryChannel, type RecoverySettings } from "@ghostcart/core";
import { schema } from "@ghostcart/db";
import { eq } from "drizzle-orm";
import { getDb } from "../db";

const { recoverySettings } = schema;

export class RecoveryError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(" "));
  }
}

/** A store's Privilege settings (defaults, i.e. off, when it has never set them). */
export async function getRecovery(storeId: string): Promise<RecoverySettings> {
  const db = await getDb();
  const [row] = await db.select().from(recoverySettings).where(eq(recoverySettings.storeId, storeId));
  if (!row) return { ...RECOVERY_DEFAULTS };
  return {
    enabled: row.enabled,
    maxDiscountPct: row.maxDiscountPct ?? undefined,
    autoApprovePct: row.autoApprovePct ?? undefined,
    delayMinutes: row.delayMinutes,
    channels: row.channels as RecoveryChannel[],
    exitPrompt: row.exitPrompt,
  };
}

export async function setRecovery(storeId: string, input: Partial<RecoverySettings>): Promise<RecoverySettings> {
  const next = { ...(await getRecovery(storeId)), ...input };
  const errors = validateRecovery(next);
  if (errors.length) throw new RecoveryError(errors);
  const db = await getDb();
  const values = {
    enabled: next.enabled,
    maxDiscountPct: next.maxDiscountPct ?? null,
    autoApprovePct: next.autoApprovePct ?? null,
    delayMinutes: next.delayMinutes,
    channels: [...new Set(next.channels)],
    exitPrompt: next.exitPrompt,
    updatedAt: new Date(),
  };
  await db.insert(recoverySettings).values({ storeId, ...values }).onConflictDoUpdate({ target: recoverySettings.storeId, set: values });
  return next;
}
