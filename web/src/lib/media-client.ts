import type {
  ImageMimeType,
  UploadUrlError,
  UploadUrlRequest,
  UploadUrlResponse,
} from "@/lib/media";

// Browser-only helpers for the media upload flow.

export class UploadError extends Error {}

type CompressOptions = { maxBytes?: number; maxDimension?: number };

export type CompressedImage = {
  blob: Blob;
  type: ImageMimeType;
  width: number;
  height: number;
};

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    // Applies EXIF orientation so phone photos aren't sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Fallback for browsers without createImageBitmap options support.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
    } catch {
      throw new UploadError("That image couldn't be read. Try a JPEG, PNG or WebP.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Re-encodes an image as WebP (JPEG where WebP encoding isn't supported),
 * shrinking quality and then dimensions until it fits in `maxBytes`.
 * Re-encoding through a canvas also strips EXIF metadata such as GPS location.
 */
export async function compressImage(
  file: File,
  { maxBytes = 200 * 1024, maxDimension = 1600 }: CompressOptions = {},
): Promise<CompressedImage> {
  const image = await decode(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new UploadError("Your browser can't process images.");

  let type: ImageMimeType = "image/webp";
  let scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  let best: CompressedImage | null = null;

  try {
    for (let pass = 0; pass < 6; pass++) {
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      canvas.width = width;
      canvas.height = height;
      if (type === "image/jpeg") {
        ctx.fillStyle = "#ffffff"; // JPEG has no alpha: flatten onto white
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image.source, 0, 0, width, height);

      for (const quality of [0.82, 0.7, 0.58, 0.46]) {
        const blob = await canvasToBlob(canvas, type, quality);
        if (!blob) continue;
        if (blob.type !== type) {
          // Encoder fell back (no WebP support): redo this pass as JPEG.
          type = "image/jpeg";
          pass--;
          break;
        }
        if (!best || blob.size < best.blob.size) best = { blob, type, width, height };
        if (blob.size <= maxBytes) return best;
      }
      if (best?.type === type) scale *= 0.75;
    }
  } finally {
    image.close();
  }

  if (!best) throw new UploadError("That image couldn't be processed.");
  return best; // smallest result we could reach
}

/** Asks our API for a presigned R2 PUT URL. */
export async function requestUploadUrl(body: UploadUrlRequest): Promise<UploadUrlResponse> {
  let res: Response;
  try {
    res = await fetch("/api/media/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new UploadError("Can't reach the server. Check your connection.");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as UploadUrlError | null;
    throw new UploadError(data?.error ?? "Couldn't prepare the upload.");
  }
  return (await res.json()) as UploadUrlResponse;
}

/** PUTs the file straight to R2, reporting progress from 0 to 1. */
export function uploadToR2(
  target: UploadUrlResponse,
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.uploadUrl);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new UploadError(`Upload failed (${xhr.status}). Please try again.`));
    xhr.onerror = () => reject(new UploadError("Upload failed. Check your connection."));
    xhr.ontimeout = () => reject(new UploadError("Upload timed out. Please try again."));
    xhr.timeout = 120_000;
    xhr.send(blob);
  });
}
