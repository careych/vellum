import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Module-level singleton — created once per server process, reused across requests.
// All R2 credentials stay server-side; never exposed to the browser.
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

/**
 * Returns a presigned PUT URL valid for `expiresIn` seconds (default 1 hour).
 *
 * WHY presigned direct upload:
 *   Vercel free tier caps serverless function payloads at 4.5 MB.
 *   With presigned URLs the file goes browser → R2 directly, so:
 *   - No Vercel payload limit (files of any size)
 *   - No double-transfer cost or latency
 *   - Original bytes reach R2 untouched (lossless)
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(r2, command, { expiresIn })
}

export async function uploadObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
}

export async function deleteObject(key: string): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })
  )
}

/**
 * Permanent public URL for an object.
 * Requires r2.dev public access enabled on the bucket (set up in Cloudflare dashboard).
 * These URLs never expire — correct for a lifelong archive.
 */
export function getPublicUrl(key: string): string {
  return `${process.env.R2_PUBLIC_URL}/${key}`
}
