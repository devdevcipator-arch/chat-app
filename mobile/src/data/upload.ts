import { File, UploadType } from "expo-file-system";
import { AppError, isOfflineError } from "../lib/errors";
import { Network } from "../state/network";

/** Size in bytes of a local file (0 if it can't be read). */
export async function fileSize(uri: string): Promise<number> {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

/**
 * PUTs a local file to a presigned R2 URL, streamed natively with progress
 * (0–1). [headers] are part of the signature and must be sent exactly; the
 * signed Content-Length is the file's real size.
 */
export async function uploadFile({
  uploadUrl,
  headers,
  uri,
  onProgress,
}: {
  uploadUrl: string;
  headers: Record<string, string>;
  uri: string;
  onProgress?: (fraction: number) => void;
}) {
  let result;
  try {
    result = await new File(uri).upload(uploadUrl, {
      httpMethod: "PUT",
      uploadType: UploadType.BINARY_CONTENT,
      headers,
      sessionType: "foreground",
      onProgress: onProgress
        ? ({ bytesSent, totalBytes }) => onProgress(totalBytes > 0 ? bytesSent / totalBytes : 0)
        : undefined,
    });
  } catch (e) {
    Network.reportFailure(e);
    if (isOfflineError(e)) throw new AppError("Upload failed. Check your connection.", undefined, true);
    throw new AppError("Upload failed. Please try again.");
  }
  if (result.status < 200 || result.status >= 300) {
    throw new AppError(`Upload failed (${result.status}). Please try again.`);
  }
  onProgress?.(1);
}
