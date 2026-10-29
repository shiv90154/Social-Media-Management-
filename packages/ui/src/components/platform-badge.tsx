import {
  Facebook,
  Instagram,
  Linkedin,
  Youtube,
  Music2,
  AtSign,
  Pin,
  Ghost,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";

export type PlatformKey =
  | "INSTAGRAM"
  | "FACEBOOK"
  | "LINKEDIN"
  | "X"
  | "YOUTUBE"
  | "TIKTOK"
  | "THREADS"
  | "PINTEREST"
  | "SNAPCHAT";

interface PlatformMeta {
  label: string;
  icon: LucideIcon;
  colorVar: string;
}

export const PLATFORM_META: Record<PlatformKey, PlatformMeta> = {
  INSTAGRAM: { label: "Instagram", icon: Instagram, colorVar: "text-platform-instagram" },
  FACEBOOK: { label: "Facebook", icon: Facebook, colorVar: "text-platform-facebook" },
  LINKEDIN: { label: "LinkedIn", icon: Linkedin, colorVar: "text-platform-linkedin" },
  X: { label: "X", icon: AtSign, colorVar: "text-platform-x" },
  YOUTUBE: { label: "YouTube", icon: Youtube, colorVar: "text-platform-youtube" },
  TIKTOK: { label: "TikTok", icon: Music2, colorVar: "text-platform-tiktok" },
  THREADS: { label: "Threads", icon: AtSign, colorVar: "text-platform-threads" },
  PINTEREST: { label: "Pinterest", icon: Pin, colorVar: "text-platform-pinterest" },
  SNAPCHAT: { label: "Snapchat", icon: Ghost, colorVar: "text-platform-snapchat" },
};

export function PlatformIcon({ platform, className }: { platform: PlatformKey; className?: string }) {
  const meta = PLATFORM_META[platform];
  const Icon = meta.icon;
  return <Icon className={cn("h-4 w-4", meta.colorVar, className)} aria-label={meta.label} />;
}

export function PlatformBadge({ platform }: { platform: PlatformKey }) {
  const meta = PLATFORM_META[platform];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium">
      <PlatformIcon platform={platform} />
      {meta.label}
    </span>
  );
}
