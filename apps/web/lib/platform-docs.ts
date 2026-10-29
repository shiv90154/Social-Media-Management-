import type { PlatformType } from "@smm/db";

export const PLATFORM_ENV_VARS: Record<PlatformType, string[]> = {
  INSTAGRAM: ["META_APP_ID", "META_APP_SECRET"],
  FACEBOOK: ["META_APP_ID", "META_APP_SECRET"],
  LINKEDIN: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  X: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  YOUTUBE: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
  TIKTOK: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  THREADS: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
  PINTEREST: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"],
  SNAPCHAT: ["SNAPCHAT_CLIENT_ID", "SNAPCHAT_CLIENT_SECRET"],
};

export const PLATFORM_DOCS_URL: Record<PlatformType, string> = {
  INSTAGRAM: "https://developers.facebook.com/docs/instagram-api",
  FACEBOOK: "https://developers.facebook.com/docs/pages-api",
  LINKEDIN: "https://learn.microsoft.com/en-us/linkedin/consumer/",
  X: "https://developer.x.com/en/docs",
  YOUTUBE: "https://developers.google.com/youtube/v3",
  TIKTOK: "https://developers.tiktok.com/doc/content-posting-api-get-started",
  THREADS: "https://developers.facebook.com/docs/threads",
  PINTEREST: "https://developers.pinterest.com/docs/api/v5/",
  SNAPCHAT: "https://businesshelp.snapchat.com/s/article/api-marketing",
};
