import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { HttpsProxyAgent } from "https-proxy-agent";
import { fail } from "../lib/validation.js";
const uploadsDir = path.resolve(process.env.UPLOADS_DIRECTORY || "uploads");
const required = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];
export function storageStatus() {
  const requested =
    process.env.IMAGE_STORAGE === "cloudinary" ||
    (!process.env.IMAGE_STORAGE && required.some((key) => process.env[key]));
  const missing = requested ? required.filter((key) => !process.env[key]) : [];
  return {
    provider: requested ? "cloudinary" : "local",
    configured: !missing.length,
    missing,
  };
}
function cloudOptions() {
  const options = { resource_type: "image", timeout: 30000 };
  if (process.env.HTTPS_PROXY)
    options.agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
  return options;
}
function configure() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}
export async function uploadImage(
  buffer,
  { folder = "community", client = cloudinary } = {},
) {
  const status = storageStatus();
  if (!status.configured)
    fail(
      "Complete the backend Cloudinary settings before uploading images.",
      503,
    );
  if (!Buffer.isBuffer(buffer) || buffer.length > 5 * 1024 * 1024)
    fail("Images must be at most 5 MB.");
  let image, metadata;
  try {
    const { default: sharp } = await import("sharp");
    const input = sharp(buffer, {
      limitInputPixels: 20000000,
      failOn: "warning",
    });
    metadata = await input.metadata();
    if (!["jpeg", "png", "gif", "webp"].includes(metadata.format))
      throw new Error("Unsupported image format");
    const output = await input
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    image = output.data;
    metadata = output.info;
  } catch {
    fail("Upload a valid JPEG, PNG, GIF or WebP image up to 20 megapixels.");
  }
  if (status.provider === "local") {
    const filename = `${randomUUID()}.webp`;
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.join(uploadsDir, filename), image, { flag: "wx" });
    return {
      imageUrl: `/uploads/${filename}`,
      imageStorage: "local",
      imagePublicId: "",
      width: Math.min(2000, metadata.width || 0),
      height: Math.min(2000, metadata.height || 0),
    };
  }
  if (!["community", "cms"].includes(folder)) fail("Invalid image folder.");
  configure();
  try {
    const result = await new Promise((resolve, reject) => {
      const stream = client.uploader.upload_stream(
        {
          ...cloudOptions(),
          folder: `cosmobit-labs/${folder}`,
          public_id: randomUUID(),
          overwrite: false,
          format: "webp",
        },
        (error, data) => (error ? reject(error) : resolve(data)),
      );
      stream.end(image);
    });
    if (!result?.secure_url?.startsWith("https://") || !result.public_id)
      throw new Error("Invalid upload response");
    return {
      imageUrl: result.secure_url,
      imageStorage: "cloudinary",
      imagePublicId: result.public_id,
      width: result.width,
      height: result.height,
    };
  } catch {
    fail(
      "Image upload failed. Check Cloudinary configuration and connectivity.",
      503,
    );
  }
}
export async function deleteImage(record, { client = cloudinary } = {}) {
  if (record.imageStorage === "cloudinary" && record.imagePublicId) {
    const status = storageStatus();
    if (!status.configured)
      throw new Error("Cloudinary is not configured for image cleanup");
    configure();
    await client.uploader.destroy(record.imagePublicId, {
      ...cloudOptions(),
      invalidate: true,
    });
    return;
  }
  if (record.imageUrl?.startsWith("/uploads/")) {
    const filename = path.basename(record.imageUrl);
    if (/^[a-f0-9-]{36}\.webp$/.test(filename))
      await fs.unlink(path.join(uploadsDir, filename)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
}
