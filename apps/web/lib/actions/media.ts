"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@smm/db";
import { buildStorageKey, deleteObject, getUploadUrl, probeImage, probeVideo, publicUrlForKey } from "@smm/storage";
import { getCurrentContext } from "@/lib/current-org";

export interface CreateUploadUrlInput {
  filename: string;
  contentType: string;
}

export async function createUploadUrlAction(input: CreateUploadUrlInput) {
  const ctx = await getCurrentContext();
  const storageKey = buildStorageKey(ctx.organizationId, input.filename);
  const uploadUrl = await getUploadUrl(storageKey, input.contentType);
  return { uploadUrl, storageKey, publicUrl: publicUrlForKey(storageKey) };
}

export interface FinalizeMediaInput {
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  kind: "image" | "video" | "gif";
}

export async function finalizeMediaAction(input: FinalizeMediaInput) {
  const ctx = await getCurrentContext();
  const url = publicUrlForKey(input.storageKey);

  let width: number | null = null;
  let height: number | null = null;
  let durationSec: number | null = null;

  try {
    if (input.kind === "image" || input.kind === "gif") {
      const bytes = await fetch(url).then((r) => r.arrayBuffer());
      const meta = await probeImage(Buffer.from(bytes));
      width = meta.width;
      height = meta.height;
    } else {
      const meta = await probeVideo(url);
      width = meta.width;
      height = meta.height;
      durationSec = meta.durationSec;
    }
  } catch {
    // Metadata probing is best-effort; per-platform validation degrades to
    // "unknown" limits rather than blocking the upload entirely.
  }

  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId: ctx.organizationId,
      type: input.kind.toUpperCase() as "IMAGE" | "VIDEO" | "GIF",
      storageKey: input.storageKey,
      url,
      mimeType: input.contentType,
      sizeBytes: input.sizeBytes,
      width,
      height,
      durationSec,
      filename: input.filename,
      createdBy: ctx.userId,
    },
  });

  revalidatePath("/media");
  return { asset };
}

export async function deleteMediaAction(mediaAssetId: string) {
  const ctx = await getCurrentContext();
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaAssetId, organizationId: ctx.organizationId } });
  if (!asset) return;
  await prisma.mediaAsset.delete({ where: { id: asset.id } });
  await deleteObject(asset.storageKey).catch(() => {});
  revalidatePath("/media");
}
