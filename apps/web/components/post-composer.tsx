"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, FileVideo, Loader2 } from "lucide-react";
import type { MediaAsset } from "@prisma/client";
import type { PlatformCapabilities } from "@smm/connectors";
import { Button, Card, CardContent, Label, PlatformIcon, Textarea, cn, type PlatformKey } from "@smm/ui";
import { MediaUploader } from "./media-uploader";
import { savePostAction } from "@/lib/actions/posts";

interface ComposerAccount {
  id: string;
  platform: string;
  displayName: string;
  handle: string | null;
}

export function PostComposer({
  accounts,
  initialMedia,
  capabilities,
}: {
  accounts: ComposerAccount[];
  initialMedia: MediaAsset[];
  capabilities: Record<string, PlatformCapabilities>;
}) {
  const router = useRouter();
  const [baseCaption, setBaseCaption] = useState("");
  const [media, setMedia] = useState(initialMedia);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [customizing, setCustomizing] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<"draft" | "now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMedia = useMemo(
    () => selectedMediaIds.map((id) => media.find((m) => m.id === id)).filter((m): m is MediaAsset => Boolean(m)),
    [selectedMediaIds, media],
  );

  function toggleAccount(id: string) {
    setSelectedAccountIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  function toggleMedia(id: string) {
    setSelectedMediaIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  function warningsFor(account: ComposerAccount): string[] {
    const caps = capabilities[account.platform];
    if (!caps) return [];
    const warnings: string[] = [];
    if (!caps.supportsPublishing) {
      warnings.push("Automated publishing isn't available for this platform.");
    }
    if (selectedMedia.length === 0 && !caps.supportsTextOnly) {
      warnings.push("This platform requires at least one media attachment.");
    }
    if (selectedMedia.length > caps.maxMediaCount) {
      warnings.push(`Only ${caps.maxMediaCount} media item(s) allowed.`);
    }
    for (const item of selectedMedia) {
      const kind = item.type.toLowerCase();
      if (kind === "image" && !caps.supportsImage) warnings.push("Images aren't supported here.");
      if (kind === "video" && !caps.supportsVideo) warnings.push("Video isn't supported here.");
      if (kind === "gif" && !caps.supportsGif) warnings.push("GIFs aren't supported here.");
    }
    const text = overrides[account.id] || baseCaption;
    if (caps.maxCaptionLength && text.length > caps.maxCaptionLength) {
      warnings.push(`Caption exceeds ${caps.maxCaptionLength} characters (${text.length}).`);
    }
    return warnings;
  }

  async function handleSubmit(submitMode: "draft" | "now" | "schedule") {
    setSubmitting(true);
    setError(null);
    try {
      const result = await savePostAction({
        baseCaption,
        mediaAssetIds: selectedMediaIds,
        targets: selectedAccountIds.map((id) => ({
          socialAccountId: id,
          captionOverride: customizing[id] ? overrides[id] : undefined,
        })),
        mode: submitMode,
        scheduledAt: submitMode === "schedule" ? scheduledAt : undefined,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/posts");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <Label htmlFor="caption">Caption</Label>
            <Textarea
              id="caption"
              rows={5}
              placeholder="Write your caption and hashtags…"
              value={baseCaption}
              onChange={(e) => setBaseCaption(e.target.value)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <div className="flex items-center justify-between">
              <Label>Media</Label>
              <MediaUploader onUploaded={(asset) => {
                setMedia((prev) => [asset, ...prev]);
                setSelectedMediaIds((prev) => [...prev, asset.id]);
              }} />
            </div>
            {media.length === 0 ? (
              <p className="text-sm text-muted-foreground">No media uploaded yet.</p>
            ) : (
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
                {media.map((asset) => {
                  const selected = selectedMediaIds.includes(asset.id);
                  return (
                    <button
                      type="button"
                      key={asset.id}
                      onClick={() => toggleMedia(asset.id)}
                      className={cn(
                        "relative aspect-square overflow-hidden rounded-md border-2",
                        selected ? "border-primary" : "border-transparent",
                      )}
                    >
                      {asset.type === "VIDEO" ? (
                        <div className="flex h-full w-full items-center justify-center bg-muted">
                          <FileVideo className="h-6 w-6 text-muted-foreground" />
                        </div>
                      ) : (
                        <Image src={asset.url} alt={asset.filename} fill className="object-cover" unoptimized />
                      )}
                      {selected && (
                        <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <Label>Publish</Label>
            <div className="flex flex-wrap gap-4 text-sm">
              {(["now", "schedule", "draft"] as const).map((option) => (
                <label key={option} className="flex items-center gap-2">
                  <input type="radio" checked={mode === option} onChange={() => setMode(option)} />
                  {option === "now" ? "Publish now" : option === "schedule" ? "Schedule for later" : "Save as draft"}
                </label>
              ))}
            </div>
            {mode === "schedule" && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-fit rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="button"
              disabled={submitting || (mode !== "draft" && selectedAccountIds.length === 0)}
              onClick={() => handleSubmit(mode)}
              className="w-fit"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "now" ? "Publish now" : mode === "schedule" ? "Schedule post" : "Save draft"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Platforms</h2>
        {accounts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No connected accounts yet. Connect one from Social Accounts first.
          </p>
        )}
        {accounts.map((account) => {
          const selected = selectedAccountIds.includes(account.id);
          const warnings = selected ? warningsFor(account) : [];
          return (
            <Card key={account.id} className={cn(selected && "ring-2 ring-primary")}>
              <CardContent className="flex flex-col gap-2 pt-5">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={selected} onChange={() => toggleAccount(account.id)} />
                  <PlatformIcon platform={account.platform as PlatformKey} />
                  <span className="text-sm font-medium">{account.displayName}</span>
                  {account.handle && <span className="text-xs text-muted-foreground">{account.handle}</span>}
                </label>
                {selected && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={Boolean(customizing[account.id])}
                        onChange={(e) => setCustomizing((prev) => ({ ...prev, [account.id]: e.target.checked }))}
                      />
                      Customize caption for this platform
                    </label>
                    {customizing[account.id] && (
                      <Textarea
                        rows={3}
                        value={overrides[account.id] ?? baseCaption}
                        onChange={(e) => setOverrides((prev) => ({ ...prev, [account.id]: e.target.value }))}
                      />
                    )}
                    {warnings.length > 0 && (
                      <ul className="list-disc space-y-1 pl-4 text-xs text-amber-600">
                        {warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
