import type {
  MediaValidationIssue,
  OAuthResult,
  PlatformCapabilities,
  PlatformConnector,
  PublishInput,
  PublishMediaInput,
  PublishResult,
  SocialAccountCredentials,
} from "../types";
import { validateCaptionLength, validateMediaAgainstCapabilities } from "../shared/validateMedia";
import { PlatformApiError, jsonRequest } from "../shared/http";

const REQUIRED_ENV = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"] as const;
const SCOPES = ["user.info.basic", "video.publish", "video.upload"];
const API_BASE = "https://open.tiktokapis.com/v2";

function env() {
  return { clientKey: process.env.TIKTOK_CLIENT_KEY, clientSecret: process.env.TIKTOK_CLIENT_SECRET };
}

async function queryCreatorInfo(accessToken: string): Promise<{ privacyLevelOptions: string[] }> {
  const result = await jsonRequest<{ data: { privacy_level_options: string[] } }>(
    `${API_BASE}/post/publish/creator_info/query/`,
    { method: "POST", bearerToken: accessToken, headers: { "Content-Type": "application/json" }, body: "{}" },
  );
  return { privacyLevelOptions: result.data.privacy_level_options };
}

async function pollPublishStatus(publishId: string, accessToken: string, maxAttempts = 10, delayMs = 4000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await jsonRequest<{ data: { status: string; fail_reason?: string } }>(
      `${API_BASE}/post/publish/status/fetch/`,
      {
        method: "POST",
        bearerToken: accessToken,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish_id: publishId }),
      },
    );
    if (status.data.status === "PUBLISH_COMPLETE") return;
    if (status.data.status === "FAILED") {
      throw new PlatformApiError(status.data.fail_reason ?? "TikTok failed to publish", "UNSUPPORTED_MEDIA", false);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new PlatformApiError("TikTok publish took too long to process", "UNKNOWN", true);
}

export class TikTokConnector implements PlatformConnector {
  readonly platform = "TIKTOK" as const;

  isConfigured(): boolean {
    return REQUIRED_ENV.every((key) => Boolean(process.env[key]));
  }

  getCapabilities(): PlatformCapabilities {
    return {
      platform: this.platform,
      supportsPublishing: true,
      supportsNativeScheduling: false,
      supportsImage: true,
      supportsVideo: true,
      supportsGif: false,
      supportsCarousel: true,
      supportsTextOnly: false,
      supportsAnalytics: false,
      requiresBusinessAccount: false,
      maxCaptionLength: 2200,
      maxMediaCount: 35,
      maxImageSizeMB: 20,
      maxVideoSizeMB: 4096,
      maxVideoDurationSec: 600,
      supportedAspectRatios: ["9:16"],
      notes: [
        "Direct Post publishing requires TikTok app audit approval. Until your app is approved, posts publish as SELF_ONLY (visible only to your own TikTok test account), not publicly — this app auto-detects which visibility levels your app is allowed to use.",
        "Videos/photos are fetched by TikTok from this app's media URL (PULL_FROM_URL), which requires the media host domain to be verified in your TikTok developer app.",
      ],
    };
  }

  validateMedia(media: PublishMediaInput[]): MediaValidationIssue[] {
    return [...validateMediaAgainstCapabilities(media, this.getCapabilities())];
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const { clientKey } = env();
    const url = new URL("https://www.tiktok.com/v2/auth/authorize");
    url.searchParams.set("client_key", clientKey ?? "");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES.join(","));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async handleOAuthCallback(code: string, redirectUri: string): Promise<OAuthResult> {
    const { clientKey, clientSecret } = env();
    if (!clientKey || !clientSecret) {
      throw new PlatformApiError("TikTok is not configured", "APP_NOT_APPROVED", false);
    }

    const token = await jsonRequest<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      open_id: string;
      scope: string;
    }>("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    const profile = await jsonRequest<{ data: { user: { display_name: string; avatar_url?: string } } }>(
      `${API_BASE}/user/info/?fields=open_id,display_name,avatar_url`,
      { bearerToken: token.access_token },
    );

    return {
      externalUserId: token.open_id,
      displayName: profile.data.user.display_name,
      avatarUrl: profile.data.user.avatar_url,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: token.scope.split(","),
    };
  }

  async refreshToken(account: SocialAccountCredentials): Promise<OAuthResult> {
    const { clientKey, clientSecret } = env();
    if (!clientKey || !clientSecret || !account.refreshToken) {
      throw new PlatformApiError("TikTok account has no refresh token; reconnect it", "TOKEN_EXPIRED", false);
    }
    const token = await jsonRequest<{ access_token: string; refresh_token: string; expires_in: number }>(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: account.refreshToken,
        }),
      },
    );
    return {
      externalUserId: account.externalUserId,
      displayName: "",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: [],
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const captionIssues = validateCaptionLength(input.caption, this.getCapabilities());
    if (captionIssues.length > 0) {
      return { success: false, errorCode: "VALIDATION_ERROR", errorMessage: captionIssues[0]!.message, retryable: false };
    }
    if (input.media.length === 0) {
      return { success: false, errorCode: "UNSUPPORTED_MEDIA", errorMessage: "TikTok requires media.", retryable: false };
    }

    try {
      const { privacyLevelOptions } = await queryCreatorInfo(input.account.accessToken);
      const privacyLevel = privacyLevelOptions.includes("PUBLIC_TO_EVERYONE")
        ? "PUBLIC_TO_EVERYONE"
        : (privacyLevelOptions[0] ?? "SELF_ONLY");

      const isPhoto = input.media.every((m) => m.type === "image");
      const initPath = isPhoto ? "/post/publish/content/init/" : "/post/publish/video/init/";
      const body = isPhoto
        ? {
            post_info: { title: input.caption, privacy_level: privacyLevel, disable_duplicate_check: true },
            source_info: {
              source: "PULL_FROM_URL",
              photo_images: input.media.map((m) => m.url),
              photo_cover_index: 0,
            },
            post_mode: "DIRECT_POST",
            media_type: "PHOTO",
          }
        : {
            post_info: { title: input.caption, privacy_level: privacyLevel, disable_duplicate_check: true },
            source_info: { source: "PULL_FROM_URL", video_url: input.media[0]!.url },
          };

      const init = await jsonRequest<{ data: { publish_id: string } }>(`${API_BASE}${initPath}`, {
        method: "POST",
        bearerToken: input.account.accessToken,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await pollPublishStatus(init.data.publish_id, input.account.accessToken);

      return { success: true, externalPostId: init.data.publish_id, retryable: false };
    } catch (error) {
      if (error instanceof PlatformApiError) {
        return { success: false, errorCode: error.errorCode, errorMessage: error.message, retryable: error.retryable };
      }
      return { success: false, errorCode: "UNKNOWN", errorMessage: String(error), retryable: true };
    }
  }

  async getAnalytics(): Promise<Record<string, number>> {
    return {};
  }

  async disconnect(): Promise<void> {}
}
