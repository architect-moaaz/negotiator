import { zipSync } from "fflate";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** The GhostCart WooCommerce plugin as an installable zip (until it's listed on WordPress.org). */
export async function GET() {
  const root = path.resolve(process.cwd(), "../../plugins/woocommerce/ghostcart");
  const files: Record<string, Uint8Array> = {};
  for (const name of await readdir(root)) files[`ghostcart/${name}`] = new Uint8Array(await readFile(path.join(root, name)));
  const zip = zipSync(files, { level: 9 });
  return new Response(Buffer.from(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="ghostcart-woocommerce.zip"', "Cache-Control": "public, max-age=3600" },
  });
}
