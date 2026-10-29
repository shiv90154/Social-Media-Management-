import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

function getBucket(): string {
  return process.env.MINIO_BUCKET ?? "smm-media";
}

let client: S3Client | undefined;

/** MinIO speaks the S3 API, so the standard AWS SDK works against it with a custom endpoint. */
export function getStorageClient(): S3Client {
  if (!client) {
    const endpoint = process.env.MINIO_ENDPOINT;
    const port = process.env.MINIO_PORT ?? "9000";
    const useSsl = process.env.MINIO_USE_SSL === "true";
    if (!endpoint || !process.env.MINIO_ACCESS_KEY || !process.env.MINIO_SECRET_KEY) {
      throw new Error("MinIO storage is not configured (MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY)");
    }
    client = new S3Client({
      endpoint: `${useSsl ? "https" : "http"}://${endpoint}:${port}`,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY,
        secretAccessKey: process.env.MINIO_SECRET_KEY,
      },
    });
  }
  return client;
}

export function buildStorageKey(organizationId: string, filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  return `${organizationId}/${randomUUID()}${ext}`;
}

export function publicUrlForKey(storageKey: string): string {
  const base = process.env.MINIO_PUBLIC_URL ?? `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/${getBucket()}`;
  return `${base.replace(/\/$/, "")}/${storageKey}`;
}

/** Presigned PUT URL so the browser can upload directly to MinIO without proxying bytes through Next.js. */
export async function getUploadUrl(storageKey: string, contentType: string, expiresInSec = 300): Promise<string> {
  const command = new PutObjectCommand({ Bucket: getBucket(), Key: storageKey, ContentType: contentType });
  return getSignedUrl(getStorageClient(), command, { expiresIn: expiresInSec });
}

export async function deleteObject(storageKey: string): Promise<void> {
  await getStorageClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: storageKey }));
}

export async function getDownloadUrl(storageKey: string, expiresInSec = 300): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: storageKey });
  return getSignedUrl(getStorageClient(), command, { expiresIn: expiresInSec });
}
