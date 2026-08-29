import { getObject, putObject } from "../../lib/storage";
import { authenticate, prepareDatabase } from "../workspace/route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await prepareDatabase();
    await authenticate(request);
    const src = new URL(request.url).searchParams.get("src");
    if (!src) throw new Error("Image source is required");
    const object = await getObject(src);
    if (!object) throw new Error("Template image not found");
    return new Response(object.stream, {
      headers: {
        "content-type": object.contentType || "image/png",
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load template image" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    await prepareDatabase();
    const actor = await authenticate(request);
    if (actor.role === "operator") return Response.json({ error: "Level 2 operators cannot manage template assets" }, { status: 403 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload");
    if (file.size > 2 * 1024 * 1024) throw new Error("Template images must be 2 MB or smaller");
    if (!/^image\//.test(file.type)) throw new Error("Upload a PNG, JPG, WEBP, or GIF image");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "image";
    const key = `template-assets/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
    const blob = await putObject(key, file, file.type || "image/png");
    return Response.json({ url: blob.url }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to upload template image" }, { status: 400 });
  }
}
