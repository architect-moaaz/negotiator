import { rateLimit } from "@/lib/rate-limit";
import { requireStoreAccess } from "@/lib/shop/access";
import { uploadImage, UploadError } from "@/lib/uploads";

/** Product photo upload (multipart form, field "file"). Returns { url }. */
export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/uploads">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "catalogue");
  if (denied) return denied;
  const limited = await rateLimit({ name: "upload:store", id: store.id, max: 200, windowSeconds: 60 * 60 });
  if (limited) return limited;
  const file = (await request.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a photo." }, { status: 400 });
  try {
    return Response.json({ url: await uploadImage(file, `products/${store.id}`) });
  } catch (err) {
    if (err instanceof UploadError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
