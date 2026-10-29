import type {
  MediaValidationIssue,
  OAuthResult,
  PlatformCapabilities,
  PlatformConnector,
  PublishInput,
  PublishResult,
  SocialAccountCredentials,
  PublishMediaInput,
} from "../types";
import { validateCaptionLength, validateMediaAgainstCapabilities } from "../shared/validateMedia";
import { PlatformApiError, classifyHttpStatus, jsonRequest } from "../shared/http";
import { fetchMediaBuffer } from "../shared/metaGraph";

const REQUIRED_ENV = ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"] as const;
const SCOPES = ["boards:read", "pins:read", "pins:write", "user_accounts:read"];
const API_BASE = "https://api.pinterest.com/v5";

function env() {
  return { appId: process.env.PINTEREST_APP_ID, appSecret: process.env.PINTEREST_APP_SECRET };
}

async function uploadVideoAndGetMediaId(media: PublishMediaInput, accessToken: string): Promise<string> {
  const registration = await jsonRequest<{
    media_id: string;
    upload_url: string;
    upload_parameters: Record<string, string>;
  }>(`${API_BASE}/media`, {
    method: "POST",
    bearerToken: accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "video" }),
  });

  const { buffer } = await fetchMediaBuffer(media.url);
  const form = new FormData();
  for (const [key, value] of Object.entries(registration.upload_parameters)) {
    form.set(key, value);
  }
  form.set("file", new Blob([buffer]), "video.mp4");
  const uploadResponse = await fetch(registration.upload_url, { method: "POST", body: form });
  if (!uploadResponse.ok) {
    const { errorCode, retryable } = classifyHttpStatus(uploadResponse.status);
    throw new PlatformApiError("Pinterest video upload failed", errorCode, retryable);
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const status = await jsonRequest<{ status: string }>(`${API_BASE}/media/${registration.media_id}`, {
      bearerToken: accessToken,
    });
    if (status.status === "succeeded") return registration.media_id;
    if (status.status === "failed") {
      throw new PlatformApiError("Pinterest failed to process the uploaded video", "UNSUPPORTED_MEDIA", false);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new PlatformApiError("Pinterest video processing took too long", "UNKNOWN", true);
}

export class PinterestConnector implements PlatformConnector {
  readonly platform = "PINTEREST" as const;

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
      requiresBusinessAccount: false,
      maxCaptionLength: 500,
      maxMediaCount: 5,
      maxImageSizeMB: 20,
      maxVideoSizeMB: 2048,
      maxVideoDurationSec: 900,
      supportedAspectRatios: ["2:3"],
      notes: [
        "Pins are created on the first board found on your Pinterest account at connect time. Board selection per-post isn't implemented yet.",
        "Video pins are created without a custom cover image; Pinterest will auto-generate one from the video.",
      ],
    };
  }

  validateMedia(media: PublishMediaInput[]): MediaValidationIssue[] {
    return [...validateMediaAgainstCapabilities(media, this.getCapabilities())];
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const { appId } = env();
    const url = new URL("https://www.pinterest.com/oauth/");
    url.searchParams.set("client_id", appId ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES.join(","));
    url.searchParams.set("state", state);
    return url.toString();
  }

  async handleOAuthCallback(code: string, redirectUri: string): Promise<OAuthResult> {
    const { appId, appSecret } = env();
    if (!appId || !appSecret) {
      throw new PlatformApiError("Pinterest is not configured", "APP_NOT_APPROVED", false);
    }
    const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString("base64");
    const token = await jsonRequest<{ access_token: string; refresh_token?: string; expires_in: number }>(
      `${API_BASE}/oauth/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      },
    );

    const profile = await jsonRequest<{ username: string; profile_image?: string }>(`${API_BASE}/user_account`, {
      bearerToken: token.access_token,
    });

    const boards = await jsonRequest<{ items: { id: string; name: string }[] }>(`${API_BASE}/boards`, {
      bearerToken: token.access_token,
    });
    const defaultBoard = boards.items[0];

    return {
      externalUserId: profile.username,
      displayName: profile.username,
      handle: `@${profile.username}`,
      avatarUrl: profile.profile_image,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: SCOPES,
      metadata: {
        defaultBoardId: defaultBoard?.id ?? null,
        availableBoards: boards.items.map((b) => ({ id: b.id, name: b.name })),
      },
    };
  }

  async refreshToken(account: SocialAccountCredentials): Promise<OAuthResult> {
    const { appId, appSecret } = env();
    if (!appId || !appSecret || !account.refreshToken) {
      throw new PlatformApiError("Pinterest account has no refresh token; reconnect it", "TOKEN_EXPIRED", false);
    }
    const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString("base64");
    const token = await jsonRequest<{ access_token: string; expires_in: number }>(`${API_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: account.refreshToken }),
    });
    return {
      externalUserId: account.externalUserId,
      displayName: "",
      accessToken: token.access_token,
      refreshToken: account.refreshToken,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: [],
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const captionIssues = validateCaptionLength(input.caption, this.getCapabilities());
    if (captionIssues.length > 0) {
      return { success: false, errorCode: "VALIDATION_ERROR", errorMessage: captionIssues[0]!.message, retryable: false };
    }
    const boardId = (input.account.metadata?.defaultBoardId as string | undefined) ?? null;
    if (!boardId) {
      return {
        success: false,
        errorCode: "VALIDATION_ERROR",
        errorMessage: "No Pinterest board is available on this account.",
        retryable: false,
      };
    }
    const media = input.media[0];
    if (!media) {
      return {
        success: false,
        errorCode: "UNSUPPORTED_MEDIA",
        errorMessage: "Pinterest requires at least one image or video.",
        retryable: false,
      };
    }

    try {
      const mediaSource =
        media.type === "video"
          ? { source_type: "video_id", media_id: await uploadVideoAndGetMediaId(media, input.account.accessToken) }
          : input.media.length > 1
            ? { source_type: "multiple_image_urls", items: input.media.map((m) => ({ url: m.url })) }
            : { source_type: "image_url", url: media.url };

      const pin = await jsonRequest<{ id: string }>(`${API_BASE}/pins`, {
        method: "POST",
        bearerToken: input.account.accessToken,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board_id: boardId, description: input.caption, media_source: mediaSource }),
      });

      return {
        success: true,
        externalPostId: pin.id,
        externalUrl: `https://www.pinterest.com/pin/${pin.id}`,
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
    const result = await jsonRequest<{ all: { lifetime_metrics: Record<string, number> } }>(
      `${API_BASE}/pins/${externalPostId}/analytics?metric_types=IMPRESSION,SAVE,PIN_CLICK`,
      { bearerToken: account.accessToken },
    );
    return result.all?.lifetime_metrics ?? {};
  }

  async disconnect(): Promise<void> {}
}
