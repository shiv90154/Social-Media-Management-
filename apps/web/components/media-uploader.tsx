"use client";

import { useRef, useState } from "react";
import { UploadCloud, Loader2 } from "lucide-react";
import { Button } from "@smm/ui";
import { createUploadUrlAction, finalizeMediaAction } from "@/lib/actions/media";
import type { MediaAsset } from "@prisma/client";

function kindFromMime(mimeType: string): "image" | "video" | "gif" {
  if (mimeType === "image/gif") return "gif";
  if (mimeType.startsWith("video/")) return "video";
  return "image";
}

export function MediaUploader({ onUploaded }: { onUploaded?: (asset: MediaAsset) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const { uploadUrl, storageKey } = await createUploadUrlAction({
          filename: file.name,
          contentType: file.type,
        });
        const putResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putResponse.ok) {
          throw new Error(`Upload failed for ${file.name}`);
        }
        const { asset } = await finalizeMediaAction({
          storageKey,
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          kind: kindFromMime(file.type),
        });
        onUploaded?.(asset);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {uploading ? "Uploading…" : "Upload media"}
      </Button>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
