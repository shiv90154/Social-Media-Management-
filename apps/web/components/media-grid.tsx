"use client";

import { useState } from "react";
import Image from "next/image";
import { Trash2, FileVideo } from "lucide-react";
import type { MediaAsset } from "@prisma/client";
import { Button, Card } from "@smm/ui";
import { MediaUploader } from "./media-uploader";
import { deleteMediaAction } from "@/lib/actions/media";

export function MediaGrid({ initialAssets }: { initialAssets: MediaAsset[] }) {
  const [assets, setAssets] = useState(initialAssets);

  async function handleDelete(id: string) {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    await deleteMediaAction(id);
  }

  return (
    <div className="flex flex-col gap-6">
      <MediaUploader onUploaded={(asset) => setAssets((prev) => [asset, ...prev])} />

      {assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No media yet. Upload an image, video, or GIF to get started.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {assets.map((asset) => (
            <Card key={asset.id} className="group relative overflow-hidden">
              <div className="relative aspect-square bg-muted">
                {asset.type === "VIDEO" ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <FileVideo className="h-8 w-8 text-muted-foreground" />
                  </div>
                ) : (
                  <Image src={asset.url} alt={asset.filename} fill className="object-cover" unoptimized />
                )}
              </div>
              <div className="flex items-center justify-between p-2">
                <span className="truncate text-xs text-muted-foreground">{asset.filename}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(asset.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
