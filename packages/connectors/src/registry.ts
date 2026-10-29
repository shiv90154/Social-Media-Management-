import type { PlatformConnector, PlatformType } from "./types";
import { FacebookConnector } from "./platforms/facebook";
import { InstagramConnector } from "./platforms/instagram";
import { LinkedInConnector } from "./platforms/linkedin";
import { PinterestConnector } from "./platforms/pinterest";
import { SnapchatConnector } from "./platforms/snapchat";
import { ThreadsConnector } from "./platforms/threads";
import { TikTokConnector } from "./platforms/tiktok";
import { XConnector } from "./platforms/x";
import { YouTubeConnector } from "./platforms/youtube";

const connectors: Record<PlatformType, PlatformConnector> = {
  FACEBOOK: new FacebookConnector(),
  INSTAGRAM: new InstagramConnector(),
  LINKEDIN: new LinkedInConnector(),
  X: new XConnector(),
  YOUTUBE: new YouTubeConnector(),
  TIKTOK: new TikTokConnector(),
  THREADS: new ThreadsConnector(),
  PINTEREST: new PinterestConnector(),
  SNAPCHAT: new SnapchatConnector(),
};

export const connectorRegistry = {
  get(platform: PlatformType): PlatformConnector {
    const connector = connectors[platform];
    if (!connector) {
      throw new Error(`No connector registered for platform ${platform}`);
    }
    return connector;
  },
  all(): PlatformConnector[] {
    return Object.values(connectors);
  },
  configuredPlatforms(): PlatformType[] {
    return this.all()
      .filter((c) => c.isConfigured())
      .map((c) => c.platform);
  },
};
