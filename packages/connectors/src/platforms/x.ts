import { createHash, createHmac } from "node:crypto";
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
import { PlatformApiError, classifyHttpStatus, jsonRequest } from "../shared/http";
import { fetchMediaBuffer } from "../shared/metaGraph";

const REQUIRED_ENV = ["X_CLIENT_ID", "X_CLIENT_SECRET"] as const;
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];
const UPLOAD_BASE = "https://upload.twitter.com/1.1/media/upload.json";
const CHUNK_SIZE = 5 * 1024 * 1024;

function env() {
  return { clientId: process.env.X_CLIENT_ID, clientSecret: process.env.X_CLIENT_SECRET };
}

/**
 * X's OAuth2 flow requires PKCE. Rather than persisting a code_verifier
 * between the redirect and the callback (which would need extra server-side
 * storage keyed by `state`), we derive both the challenge and the verifier
 * deterministically from `state` + our client secret. The verifier is never
 * transmitted until the callback, so it stays unguessable to anyone who only
 * observes the authorize redirect.
 */
function derivePkceVerifier(state: string): string {
  const { clientSecret } = env();
  return createHmac("sha256", clientSecret ?? "unconfigured").update(state).digest("base64url");
}

function deriveCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function mediaCategory(type: PublishMediaInput["type"]): string {
  if (type === "video") return "tweet_video";
  if (type === "gif") return "tweet_gif";
  return "tweet_image";
}

async function uploadMedia(media: PublishMediaInput, accessToken: string): Promise<string> {
  const { buffer, contentType } = await fetchMediaBuffer(media.url);
  const totalBytes = buffer.byteLength;

  const init = await jsonRequest<{ media_id_string: string }>(UPLOAD_BASE, {
    method: "POST",
    bearerToken: accessToken,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      command: "INIT",
      media_type: media.mimeType || contentType,
      total_bytes: String(totalBytes),
      media_category: mediaCategory(media.type),
    }),
  });
  const mediaId = init.media_id_string;

  let segmentIndex = 0;
  for (let offset = 0; offset < totalBytes; offset += CHUNK_SIZE) {
    const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
    const form = new FormData();
    form.set("command", "APPEND");
    form.set("media_id", mediaId);
    form.set("segment_index", String(segmentIndex));
    form.set("media", new Blob([chunk]));
    const response = await fetch(UPLOAD_BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    if (!response.ok) {
      const { errorCode, retryable } = classifyHttpStatus(response.status);
      throw new PlatformApiError(`X media APPEND failed at segment ${segmentIndex}`, errorCode, retryable);
    }
    segmentIndex += 1;
  }

  const finalize = await jsonRequest<{ processing_info?: { state: string; check_after_secs?: number } }>(
    UPLOAD_BASE,
    {
      method: "POST",
      bearerToken: accessToken,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ command: "FINALIZE", media_id: mediaId }),
    },
  );

  let processing = finalize.processing_info;
  while (processing && processing.state !== "succeeded") {
    if (processing.state === "failed") {
      throw new PlatformApiError("X failed to process the uploaded media", "UNSUPPORTED_MEDIA", false);
    }
    await new Promise((resolve) => setTimeout(resolve, (processing?.check_after_secs ?? 3) * 1000));
    const statusUrl = new URL(UPLOAD_BASE);
    statusUrl.searchParams.set("command", "STATUS");
    statusUrl.searchParams.set("media_id", mediaId);
    const status = await jsonRequest<{ processing_info?: { state: string; check_after_secs?: number } }>(
      statusUrl.toString(),
      { bearerToken: accessToken },
    );
    processing = status.processing_info;
  }

  return mediaId;
}

export class XConnector implements PlatformConnector {
  readonly platform = "X" as const;

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
      supportsGif: true,
      supportsCarousel: true,
      supportsTextOnly: true,
      supportsAnalytics: true,
      requiresBusinessAccount: false,
      maxCaptionLength: 280,
      maxMediaCount: 4,
      maxImageSizeMB: 5,
      maxVideoSizeMB: 512,
      maxVideoDurationSec: 140,
      supportedAspectRatios: null,
      notes: [
        "No native scheduling on standard API access tiers.",
        "Rate limits are strict on Free/Basic API tiers — high-volume posting may need a paid tier.",
      ],
    };
  }

  validateMedia(media: PublishMediaInput[]): MediaValidationIssue[] {
    return [...validateMediaAgainstCapabilities(media, this.getCapabilities())];
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const { clientId } = env();
    const verifier = derivePkceVerifier(state);
    const challenge = deriveCodeChallenge(verifier);
    const url = new URL("https://twitter.com/i/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async handleOAuthCallback(code: string, redirectUri: string, state?: string): Promise<OAuthResult> {
    const { clientId, clientSecret } = env();
    if (!clientId || !clientSecret) {
      throw new PlatformApiError("X is not configured", "APP_NOT_APPROVED", false);
    }
    if (!state) {
      throw new PlatformApiError("Missing OAuth state for X PKCE verification", "VALIDATION_ERROR", false);
    }
    const verifier = derivePkceVerifier(state);

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const token = await jsonRequest<{ access_token: string; refresh_token?: string; expires_in: number }>(
      "https://api.twitter.com/2/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
          client_id: clientId,
        }),
      },
    );

    const profile = await jsonRequest<{ data: { id: string; username: string; name: string; profile_image_url?: string } }>(
      "https://api.twitter.com/2/users/me?user.fields=profile_image_url",
      { bearerToken: token.access_token },
    );

    return {
      externalUserId: profile.data.id,
      displayName: profile.data.name,
      handle: `@${profile.data.username}`,
      avatarUrl: profile.data.profile_image_url,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: SCOPES,
    };
  }

  async refreshToken(account: SocialAccountCredentials): Promise<OAuthResult> {
    const { clientId, clientSecret } = env();
    if (!clientId || !clientSecret || !account.refreshToken) {
      throw new PlatformApiError("X account has no refresh token; reconnect it", "TOKEN_EXPIRED", false);
    }
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const token = await jsonRequest<{ access_token: string; refresh_token?: string; expires_in: number }>(
      "https://api.twitter.com/2/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: account.refreshToken }),
      },
    );
    return {
      externalUserId: account.externalUserId,
      displayName: "",
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? account.refreshToken,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: SCOPES,
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const captionIssues = validateCaptionLength(input.caption, this.getCapabilities());
    if (captionIssues.length > 0) {
      return { success: false, errorCode: "VALIDATION_ERROR", errorMessage: captionIssues[0]!.message, retryable: false };
    }

    try {
      const mediaIds: string[] = [];
      for (const media of input.media) {
        mediaIds.push(await uploadMedia(media, input.account.accessToken));
      }

      const tweet = await jsonRequest<{ data: { id: string } }>("https://api.twitter.com/2/tweets", {
        method: "POST",
        bearerToken: input.account.accessToken,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: input.caption,
          ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}),
        }),
      });

      return {
        success: true,
        externalPostId: tweet.data.id,
        externalUrl: `https://x.com/i/web/status/${tweet.data.id}`,
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
    const result = await jsonRequest<{ data: { public_metrics: Record<string, number> } }>(
      `https://api.twitter.com/2/tweets/${externalPostId}?tweet.fields=public_metrics`,
      { bearerToken: account.accessToken },
    );
    return result.data.public_metrics;
  }

  async disconnect(): Promise<void> {}
}
