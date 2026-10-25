import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { uploadImage, UploadError } from "@/lib/uploads";
import { addOwnershipPhoto } from "@/lib/verification/service";

/** Ownership evidence photo (multipart: file, kind = stock | marketplace). A reviewer looks at it. */
export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/verification/photo">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind") === "marketplace" ? "marketplace" : "stock";
  if (!(file instanceof File)) return Response.json({ error: "Choose a photo." }, { status: 400 });
  try {
    const url = await uploadImage(file, `verification/${store.id}`);
    const check = await addOwnershipPhoto(store, kind, url);
    await logSellerAction(store, phone, `uploaded ${kind} photo for review`);
    return Response.json({ check: { type: check.type, status: check.status } });
  } catch (err) {
    if (err instanceof UploadError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
