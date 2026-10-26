import { put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Product photos and verification documents. Vercel Blob in deployments; public/uploads in local dev. */
export class UploadError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;

/** Store an image and return its public URL. `folder` groups files, e.g. "products/st_abc". */
export async function uploadImage(file: File, folder: string) {
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new UploadError("Upload a JPG, PNG or WebP photo.");
  if (file.size > MAX_BYTES) throw new UploadError("Photos up to 5 MB, please.");
  const name = `${folder.replace(/[^\w/-]/g, "")}/${randomBytes(8).toString("hex")}.${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(name, file, { access: "public", contentType: file.type });
    return blob.url;
  }
  if (process.env.VERCEL_ENV) throw new UploadError("Photo uploads aren't set up on this deployment yet.", 503);
  // Local development: serve from public/ so the dev server can show it straight away.
  const target = path.join(process.cwd(), "public", "uploads", name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await file.arrayBuffer()));
  return `/uploads/${name}`;
}
