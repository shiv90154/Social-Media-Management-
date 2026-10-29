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
import { validateMediaAgainstCapabilities } from "../shared/validateMedia";
import { PlatformApiError, classifyHttpStatus, jsonRequest } from "../shared/http";
import { fetchMediaBuffer } from "../shared/metaGraph";

const REQUIRED_ENV = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"] as const;
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

function env() {
  return { clientId: process.env.YOUTUBE_CLIENT_ID, clientSecret: process.env.YOUTUBE_CLIENT_SECRET };
}

function deriveTitle(caption: string): string {
  const firstLine = caption.split("\n")[0]?.trim() ?? "";
  const title = firstLine.length > 0 ? firstLine : "New video";
  return title.length > 95 ? `${title.slice(0, 92)}...` : title;
}

export class YouTubeConnector implements PlatformConnector {
  readonly platform = "YOUTUBE" as const;

  isConfigured(): boolean {
    return REQUIRED_ENV.every((key) => Boolean(process.env[key]));
  }

  getCapabilities(): PlatformCapabilities {
    return {
      platform: this.platform,
      supportsPublishing: true,
      supportsNativeScheduling: true,
      supportsImage: false,
      supportsVideo: true,
      supportsGif: false,
      supportsCarousel: false,
      supportsTextOnly: false,
      supportsAnalytics: true,
      requiresBusinessAccount: false,
      maxCaptionLength: 5000,
      maxMediaCount: 1,
      maxImageSizeMB: null,
      maxVideoSizeMB: 128000,
      maxVideoDurationSec: 43200,
      supportedAspectRatios: null,
      notes: [
        "Video only — YouTube has no text-only or image-only post type reachable through the public API.",
        "The post's caption is used as the video description; the first line becomes the video title.",
        "Uploads count against your channel's daily API quota.",
      ],
    };
  }

  validateMedia(media: PublishMediaInput[]): MediaValidationIssue[] {
    return [...validateMediaAgainstCapabilities(media, this.getCapabilities())];
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const { clientId } = env();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async handleOAuthCallback(code: string, redirectUri: string): Promise<OAuthResult> {
    const { clientId, clientSecret } = env();
    if (!clientId || !clientSecret) {
      throw new PlatformApiError("YouTube is not configured", "APP_NOT_APPROVED", false);
    }

    const token = await jsonRequest<{ access_token: string; refresh_token?: string; expires_in: number }>(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      },
    );

    const channels = await jsonRequest<{
      items: { id: string; snippet: { title: string; thumbnails?: { default?: { url: string } } } }[];
    }>("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      bearerToken: token.access_token,
    });
    const channel = channels.items[0];
    if (!channel) {
      throw new PlatformApiError("No YouTube channel found for this Google account", "VALIDATION_ERROR", false);
    }

    return {
      externalUserId: channel.id,
      displayName: channel.snippet.title,
      avatarUrl: channel.snippet.thumbnails?.default?.url,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: SCOPES,
    };
  }

  async refreshToken(account: SocialAccountCredentials): Promise<OAuthResult> {
    const { clientId, clientSecret } = env();
    if (!clientId || !clientSecret || !account.refreshToken) {
      throw new PlatformApiError("YouTube account has no refresh token; reconnect it", "TOKEN_EXPIRED", false);
    }
    const token = await jsonRequest<{ access_token: string; expires_in: number }>(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          refresh_token: account.refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
        }),
      },
    );
    return {
      externalUserId: account.externalUserId,
      displayName: "",
      accessToken: token.access_token,
      refreshToken: account.refreshToken,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: SCOPES,
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const media = input.media[0];
    if (!media || media.type !== "video") {
      return {
        success: false,
        errorCode: "UNSUPPORTED_MEDIA",
        errorMessage: "YouTube requires exactly one video.",
        retryable: false,
      };
    }

    try {
      const { buffer, contentType } = await fetchMediaBuffer(media.url);
      const mimeType = media.mimeType || contentType;

      const initResponse = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.account.accessToken}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Type": mimeType,
            "X-Upload-Content-Length": String(buffer.byteLength),
          },
          body: JSON.stringify({
            snippet: { title: deriveTitle(input.caption), description: input.caption },
            status: { privacyStatus: "public" },
          }),
        },
      );
      if (!initResponse.ok) {
        const { errorCode, retryable } = classifyHttpStatus(initResponse.status);
        throw new PlatformApiError("Failed to start YouTube upload session", errorCode, retryable);
      }
      const uploadUrl = initResponse.headers.get("location");
      if (!uploadUrl) {
        throw new PlatformApiError("YouTube did not return an upload session URL", "UNKNOWN", true);
      }

      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType, "Content-Length": String(buffer.byteLength) },
        body: buffer,
      });
      if (!uploadResponse.ok) {
        const { errorCode, retryable } = classifyHttpStatus(uploadResponse.status);
        throw new PlatformApiError("YouTube video upload failed", errorCode, retryable);
      }
      const video = (await uploadResponse.json()) as { id: string };

      return {
        success: true,
        externalPostId: video.id,
        externalUrl: `https://www.youtube.com/watch?v=${video.id}`,
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
    const result = await jsonRequest<{ items: { statistics: Record<string, string> }[] }>(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${externalPostId}`,
      { bearerToken: account.accessToken },
    );
    const stats = result.items[0]?.statistics ?? {};
    return Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number(value)]));
  }

  async disconnect(): Promise<void> {}
}
