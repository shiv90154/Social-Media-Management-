import type { PlatformType } from "@smm/db";

const VALID_PLATFORMS: PlatformType[] = [
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "X",
  "YOUTUBE",
  "TIKTOK",
  "THREADS",
  "PINTEREST",
  "SNAPCHAT",
];

export function parsePlatformParam(param: string): PlatformType | null {
  const upper = param.toUpperCase();
  return (VALID_PLATFORMS as string[]).includes(upper) ? (upper as PlatformType) : null;
}

export function oauthRedirectUri(platform: PlatformType): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/api/oauth/${platform.toLowerCase()}/callback`;
}
