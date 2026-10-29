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
import { THREADS_GRAPH_BASE, graphRequest } from "../shared/metaGraph";

const REQUIRED_ENV = ["THREADS_APP_ID", "THREADS_APP_SECRET"] as const;
const SCOPES = ["threads_basic", "threads_content_publish"];

function env() {
  return { appId: process.env.THREADS_APP_ID, appSecret: process.env.THREADS_APP_SECRET };
}

async function pollUntilFinished(creationId: string, accessToken: string, maxAttempts = 10, delayMs = 3000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await graphRequest<{ status: string }>(THREADS_GRAPH_BASE, `/${creationId}`, accessToken, {
      params: { fields: "status" },
    });
    if (status.status === "FINISHED") return;
    if (status.status === "ERROR") {
      throw new PlatformApiError("Threads failed to process the media container", "UNSUPPORTED_MEDIA", false);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new PlatformApiError("Threads media container took too long to process", "UNKNOWN", true);
}

export class ThreadsConnector implements PlatformConnector {
  readonly platform = "THREADS" as const;

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
      supportsTextOnly: true,
      supportsAnalytics: true,
      requiresBusinessAccount: false,
      maxCaptionLength: 500,
      maxMediaCount: 10,
      maxImageSizeMB: 8,
      maxVideoSizeMB: 1024,
      maxVideoDurationSec: 300,
      supportedAspectRatios: null,
      notes: [
        "No native scheduling; posts are queued via this app's worker.",
        "Threads API is newer/more limited than the Instagram Graph API — expect stricter rate limits.",
      ],
    };
  }

  validateMedia(media: PublishMediaInput[]): MediaValidationIssue[] {
    return [...validateMediaAgainstCapabilities(media, this.getCapabilities())];
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const { appId } = env();
    const url = new URL("https://threads.net/oauth/authorize");
    url.searchParams.set("client_id", appId ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async handleOAuthCallback(code: string, redirectUri: string): Promise<OAuthResult> {
    const { appId, appSecret } = env();
    if (!appId || !appSecret) {
      throw new PlatformApiError("Threads is not configured", "APP_NOT_APPROVED", false);
    }

    const form = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });
    const shortLived = await jsonRequest<{ access_token: string; user_id: string }>(
      "https://graph.threads.net/oauth/access_token",
      { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const exchangeUrl = new URL("https://graph.threads.net/access_token");
    exchangeUrl.searchParams.set("grant_type", "th_exchange_token");
    exchangeUrl.searchParams.set("client_secret", appSecret);
    exchangeUrl.searchParams.set("access_token", shortLived.access_token);
    const longLived = await jsonRequest<{ access_token: string; expires_in: number }>(exchangeUrl.toString());

    const profile = await graphRequest<{ id: string; username: string; threads_profile_picture_url?: string }>(
      THREADS_GRAPH_BASE,
      "/me",
      longLived.access_token,
      { params: { fields: "id,username,threads_profile_picture_url" } },
    );

    return {
      externalUserId: profile.id,
      displayName: profile.username,
      handle: `@${profile.username}`,
      avatarUrl: profile.threads_profile_picture_url,
      accessToken: longLived.access_token,
      expiresAt: new Date(Date.now() + longLived.expires_in * 1000),
      scopes: SCOPES,
    };
  }

  async refreshToken(account: SocialAccountCredentials): Promise<OAuthResult> {
    const refreshUrl = new URL("https://graph.threads.net/refresh_access_token");
    refreshUrl.searchParams.set("grant_type", "th_refresh_token");
    refreshUrl.searchParams.set("access_token", account.accessToken);
    const refreshed = await jsonRequest<{ access_token: string; expires_in: number }>(refreshUrl.toString());
    return {
      externalUserId: account.externalUserId,
      displayName: "",
      accessToken: refreshed.access_token,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      scopes: [],
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const userId = input.account.externalUserId;
    const captionIssues = validateCaptionLength(input.caption, this.getCapabilities());
    if (captionIssues.length > 0) {
      return { success: false, errorCode: "VALIDATION_ERROR", errorMessage: captionIssues[0]!.message, retryable: false };
    }

    try {
      const media = input.media[0];
      const params: Record<string, string> = { text: input.caption };
      if (media?.type === "video") {
        params.media_type = "VIDEO";
        params.video_url = media.url;
      } else if (media?.type === "image") {
        params.media_type = "IMAGE";
        params.image_url = media.url;
      } else {
        params.media_type = "TEXT";
      }

      const container = await graphRequest<{ id: string }>(
        THREADS_GRAPH_BASE,
        `/${userId}/threads`,
        input.account.accessToken,
        { method: "POST", body: new URLSearchParams(params) },
      );

      if (media?.type === "video") {
        await pollUntilFinished(container.id, input.account.accessToken);
      }

      const published = await graphRequest<{ id: string }>(
        THREADS_GRAPH_BASE,
        `/${userId}/threads_publish`,
        input.account.accessToken,
        { method: "POST", body: new URLSearchParams({ creation_id: container.id }) },
      );

      return { success: true, externalPostId: published.id, retryable: false };
    } catch (error) {
      if (error instanceof PlatformApiError) {
        return { success: false, errorCode: error.errorCode, errorMessage: error.message, retryable: error.retryable };
      }
      return { success: false, errorCode: "UNKNOWN", errorMessage: String(error), retryable: true };
    }
  }

  async getAnalytics(externalPostId: string, account: SocialAccountCredentials): Promise<Record<string, number>> {
    const result = await graphRequest<{ data: { name: string; values: { value: number }[] }[] }>(
      THREADS_GRAPH_BASE,
      `/${externalPostId}/insights`,
      account.accessToken,
      { params: { metric: "views,likes,replies,reposts" } },
    );
    const metrics: Record<string, number> = {};
    for (const item of result.data) {
      metrics[item.name] = item.values[0]?.value ?? 0;
    }
    return metrics;
  }

  async disconnect(): Promise<void> {}
}
