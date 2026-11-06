import { S3Client } from "@aws-sdk/client-s3";

// Server-only: Cloudflare R2 via its S3-compatible API. The secret env vars
// below have no NEXT_PUBLIC_ prefix, so they are never bundled for the browser.

export type R2Config = {
  client: S3Client;
  bucket: string;
};

let cached: R2Config | null = null;

/** Returns null when R2 isn't configured (the route answers 503). */
export function getR2(): R2Config | null {
  if (cached) return cached;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // R2's documented URL style: <account>.r2.cloudflarestorage.com/<bucket>/<key>
    forcePathStyle: true,
    // AWS SDK v3 adds CRC32 checksum params to presigned URLs by default,
    // which browsers can't send and R2 rejects. Only checksum when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  cached = { client, bucket };
  return cached;
}
