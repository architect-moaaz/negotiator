import { schema } from "@ghostcart/db";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireStoreAccess } from "@/lib/shop/access";

/** The store's platform connections (Shopify, WooCommerce, Amazon) with import status. Never the tokens. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/connections">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const db = await getDb();
  const rows = await db.select().from(schema.platformConnections).where(eq(schema.platformConnections.storeId, store.id));
  return Response.json(
    {
      connections: rows.map((c) => ({
        platform: c.platform,
        externalId: c.externalId,
        installedAt: c.installedAt,
        uninstalledAt: c.uninstalledAt,
        imported: c.meta.imported ?? null,
        importedAt: c.meta.importedAt ?? null,
        importing: Boolean(c.meta.reportId && !c.meta.importedAt),
        lastError: c.meta.lastError ?? null,
        syncedAt: c.meta.syncedAt ?? null,
        updated: c.meta.updated ?? null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
