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
import { FACEBOOK_GRAPH_BASE, exchangeForLongLivedToken, graphRequest, listManagedPages } from "../shared/metaGraph";

const REQUIRED_ENV = ["META_APP_ID", "META_APP_SECRET"] as const;
const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
];

function env() {
  return { appId: process.env.META_APP_ID, appSecret: process.env.META_APP_SECRET };
}

async function pollContainerUntilReady(
  containerId: string,
  accessToken: string,
  maxAttempts = 10,
  delayMs = 3000,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await graphRequest<{ status_code: string }>(
      FACEBOOK_GRAPH_BASE,
      `/${containerId}`,
      accessToken,
      { params: { fields: "status_code" } },
    );
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR") {
      throw new PlatformApiError("Instagram failed to process the media container", "UNSUPPORTED_MEDIA", false);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new PlatformApiError("Instagram media container took too long to process", "UNKNOWN", true);
}

export class InstagramConnector implements PlatformConnector {
  readonly platform = "INSTAGRAM" as const;

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
      supportsAnalytics: true,
      requiresBusinessAccount: true,
      maxCaptionLength: 2200,
      maxMediaCount: 10,
      maxImageSizeMB: 8,
      maxVideoSizeMB: 1024,
      maxVideoDurationSec: 900,
      supportedAspectRatios: ["1:1", "4:5", "1.91:1", "9:16"],
      notes: [
        "Requires an Instagram Business or Creator account linked to a Facebook Page.",
        "Video is published as a Reel; carousels of images/video are supported up to 10 items.",
      ],
    };
  }

  validateMedia(media: PublishMediaInput[]): MediaValidationIssue[] {
    return [...validateMediaAgainstCapabilities(media, this.getCapabilities())];
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const { appId } = env();
    const url = new URL("https://www.facebook.com/v19.0/dialog/oauth");
    url.searchParams.set("client_id", appId ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    return url.toString();
  }

  async handleOAuthCallback(code: string, redirectUri: string): Promise<OAuthResult> {
    const { appId, appSecret } = env();
    if (!appId || !appSecret) {
      throw new PlatformApiError("Instagram is not configured", "APP_NOT_APPROVED", false);
    }

    const tokenUrl = new URL(`${FACEBOOK_GRAPH_BASE}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);
    const shortLived = await jsonRequest<{ access_token: string }>(tokenUrl.toString());
    const longLived = await exchangeForLongLivedToken(shortLived.access_token, appId, appSecret);

    const pages = await listManagedPages(longLived.access_token);
    const pageWithIg = pages.find((p) => p.instagram_business_account?.id);
    if (!pageWithIg?.instagram_business_account) {
      throw new PlatformApiError(
        "No Instagram Business account is linked to any of your Facebook Pages. Convert your Instagram account to a Business/Creator account and link it to a Page first.",
        "VALIDATION_ERROR",
        false,
      );
    }

    const igUserId = pageWithIg.instagram_business_account.id;
    const igProfile = await graphRequest<{ username: string; profile_picture_url?: string }>(
      FACEBOOK_GRAPH_BASE,
      `/${igUserId}`,
      pageWithIg.access_token,
      { params: { fields: "username,profile_picture_url" } },
    );

    return {
      externalUserId: igUserId,
      displayName: igProfile.username,
      handle: `@${igProfile.username}`,
      avatarUrl: igProfile.profile_picture_url,
      accessToken: pageWithIg.access_token,
      scopes: SCOPES,
      metadata: { linkedFacebookPageId: pageWithIg.id },
    };
  }

  async refreshToken(): Promise<OAuthResult> {
    throw new PlatformApiError(
      "Instagram tokens are tied to the linked Facebook Page; reconnect this account if it expires.",
      "TOKEN_EXPIRED",
      false,
    );
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const igUserId = input.account.externalUserId;
    const captionIssues = validateCaptionLength(input.caption, this.getCapabilities());
    if (captionIssues.length > 0) {
      return { success: false, errorCode: "VALIDATION_ERROR", errorMessage: captionIssues[0]!.message, retryable: false };
    }
    const media = input.media[0];
    if (!media) {
      return {
        success: false,
        errorCode: "UNSUPPORTED_MEDIA",
        errorMessage: "Instagram requires at least one image or video.",
        retryable: false,
      };
    }

    try {
      const containerParams: Record<string, string> = { caption: input.caption };
      if (media.type === "video") {
        containerParams.media_type = "REELS";
        containerParams.video_url = media.url;
      } else {
        containerParams.image_url = media.url;
      }

      const container = await graphRequest<{ id: string }>(
        FACEBOOK_GRAPH_BASE,
        `/${igUserId}/media`,
        input.account.accessToken,
        { method: "POST", body: new URLSearchParams(containerParams) },
      );

      if (media.type === "video") {
        await pollContainerUntilReady(container.id, input.account.accessToken);
      }

      const published = await graphRequest<{ id: string }>(
        FACEBOOK_GRAPH_BASE,
        `/${igUserId}/media_publish`,
        input.account.accessToken,
        { method: "POST", body: new URLSearchParams({ creation_id: container.id }) },
      );

      return {
        success: true,
        externalPostId: published.id,
        externalUrl: `https://www.instagram.com/p/${published.id}`,
        retryable: false,
      };
    } catch (error) {
      if (error instanceof PlatformApiError) {
        return { success: false, errorCode: error.errorCode, errorMessage: error.message, retryable: error.retryable };
      }
      return { success: false, errorCode: "UNKNOWN", errorMessage: String(error), retryable: true };
    }
  }

  async getAnalytics(externalPostId: string, account: SocialAccountCredentials): Promise<Record<string, number>> {
    const result = await graphRequest<{ data: { name: string; values: { value: number }[] }[] }>(
      FACEBOOK_GRAPH_BASE,
      `/${externalPostId}/insights`,
      account.accessToken,
      { params: { metric: "impressions,reach,likes,comments,saved" } },
    );
    const metrics: Record<string, number> = {};
    for (const item of result.data) {
      metrics[item.name] = item.values[0]?.value ?? 0;
    }
    return metrics;
  }

  async disconnect(): Promise<void> {}
}
