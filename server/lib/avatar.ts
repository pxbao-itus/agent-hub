import { TRPCError } from "@trpc/server";

const MAX_AVATAR_BYTES = parseInt(process.env.MAX_AVATAR_BYTES ?? "", 10) || 1_048_576;

const PRIVATE_HOSTNAMES = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^::1$/,
  /^169\.254\.\d+\.\d+$/,
];

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOSTNAMES.some((re) => re.test(hostname));
}

export async function validateAvatarUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid URL" });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "URL must use http or https" });
  }

  if (isPrivateHost(parsed.hostname)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "URL must not point to a private address" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const head = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
    clearTimeout(timeout);

    const contentType = head.headers.get("content-type") ?? "";
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)/i.test(contentType)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "URL does not point to a supported image (png, jpg, webp, gif, svg)" });
    }

    const contentLength = head.headers.get("content-length");
    if (contentLength === null) {
      // No size info — reject for safety
      throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot determine image size; server did not return Content-Length" });
    }
    if (parseInt(contentLength, 10) > MAX_AVATAR_BYTES) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Image exceeds size limit (${Math.round(MAX_AVATAR_BYTES / 1024)}KB)`,
      });
    }
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({ code: "BAD_REQUEST", message: "Failed to fetch image URL" });
  }
}
