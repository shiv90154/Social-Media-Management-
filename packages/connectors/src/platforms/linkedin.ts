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

const REQUIRED_ENV = ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"] as const;
const SCOPES = ["openid", "profile", "email", "w_member_social"];
const API_BASE = "https://api.linkedin.com/v2";
const RESTLI_HEADERS = { "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json" };

function env() {
  return { clientId: process.env.LINKEDIN_CLIENT_ID, clientSecret: process.env.LINKEDIN_CLIENT_SECRET };
}

interface RegisterUploadResponse {
  value: {
    asset: string;
    uploadMechanism: {
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"?: { uploadUrl: string };
      "com.linkedin.digitalmedia.uploading.MultipartUploadHttpRequest"?: {
        partUploadRequests: { url: string; byteRange: { firstByte: number; lastByte: number } }[];
      };
    };
  };
}

async function registerUpload(personUrn: string, accessToken: string, recipe: string): Promise<RegisterUploadResponse> {
  return jsonRequest<RegisterUploadResponse>(`${API_BASE}/assets?action=registerUpload`, {
    method: "POST",
    bearerToken: accessToken,
    headers: RESTLI_HEADERS,
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: [recipe],
        owner: personUrn,
        serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }],
      },
    }),
  });
}

async function uploadAssetBinary(registration: RegisterUploadResponse, accessToken: string, buffer: ArrayBuffer) {
  const mechanism = registration.value.uploadMechanism;
  const single = mechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"];
  const multipart = mechanism["com.linkedin.digitalmedia.uploading.MultipartUploadHttpRequest"];

  if (single) {
    const response = await fetch(single.uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: buffer,
    });
    if (!response.ok) {
      const { errorCode, retryable } = classifyHttpStatus(response.status);
      throw new PlatformApiError("LinkedIn media upload failed", errorCode, retryable);
    }
    return;
  }

  if (multipart) {
    // Best-effort chunked upload per LinkedIn's documented byte-range parts.
    for (const part of multipart.partUploadRequests) {
      const chunk = buffer.slice(part.byteRange.firstByte, part.byteRange.lastByte + 1);
      const response = await fetch(part.url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: chunk,
      });
      if (!response.ok) {
        const { errorCode, retryable } = classifyHttpStatus(response.status);
        throw new PlatformApiError("LinkedIn chunked media upload failed", errorCode, retryable);
      }
    }
    return;
  }

  throw new PlatformApiError("LinkedIn returned an unrecognized upload mechanism", "UNKNOWN", false);
}

export class LinkedInConnector implements PlatformConnector {
  readonly platform = "LINKEDIN" as const;

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
      supportsCarousel: false,
      supportsTextOnly: true,
      supportsAnalytics: false,
      requiresBusinessAccount: false,
      maxCaptionLength: 3000,
      maxMediaCount: 1,
      maxImageSizeMB: 10,
      maxVideoSizeMB: 5120,
      maxVideoDurationSec: 600,
      supportedAspectRatios: null,
      notes: [
        "Posts to your personal LinkedIn profile. Posting to a Company Page requires LinkedIn Marketing Developer Platform approval (not implemented in this connector).",
        "No native scheduling; posts are queued via this app's worker.",
        "LinkedIn doesn't expose organic post analytics through the standard Share API.",
      ],
    };
  }

  validateMedia(media: PublishMediaInput[]): MediaValidationIssue[] {
    return [...validateMediaAgainstCapabilities(media, this.getCapabilities())];
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const { clientId } = env();
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", SCOPES.join(" "));
    return url.toString();
  }

  async handleOAuthCallback(code: string, redirectUri: string): Promise<OAuthResult> {
    const { clientId, clientSecret } = env();
    if (!clientId || !clientSecret) {
      throw new PlatformApiError("LinkedIn is not configured", "APP_NOT_APPROVED", false);
    }

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const token = await jsonRequest<{ access_token: string; expires_in: number; refresh_token?: string }>(
      "https://www.linkedin.com/oauth/v2/accessToken",
      { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const profile = await jsonRequest<{ sub: string; name: string; picture?: string }>(
      "https://api.linkedin.com/v2/userinfo",
      { bearerToken: token.access_token },
    );

    return {
      externalUserId: profile.sub,
      displayName: profile.name,
      avatarUrl: profile.picture,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: SCOPES,
    };
  }

  async refreshToken(): Promise<OAuthResult> {
    // LinkedIn only issues refresh tokens to apps approved for the "Sign In
    // with LinkedIn using OpenID Connect" refresh flow; standard 3-legged
    // OAuth access tokens last 60 days and must be reconnected afterward.
    throw new PlatformApiError(
      "LinkedIn access tokens don't refresh on this app tier; reconnect this account when it expires.",
      "TOKEN_EXPIRED",
      false,
    );
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const personUrn = `urn:li:person:${input.account.externalUserId}`;
    const captionIssues = validateCaptionLength(input.caption, this.getCapabilities());
    if (captionIssues.length > 0) {
      return { success: false, errorCode: "VALIDATION_ERROR", errorMessage: captionIssues[0]!.message, retryable: false };
    }

    try {
      const media = input.media[0];
      let shareMediaCategory: "NONE" | "IMAGE" | "VIDEO" = "NONE";
      let mediaAssetUrn: string | undefined;

      if (media) {
        shareMediaCategory = media.type === "video" ? "VIDEO" : "IMAGE";
        const recipe =
          media.type === "video" ? "urn:li:digitalmediaRecipe:feedshare-video" : "urn:li:digitalmediaRecipe:feedshare-image";
        const registration = await registerUpload(personUrn, input.account.accessToken, recipe);
        const { buffer } = await fetchMediaBuffer(media.url);
        await uploadAssetBinary(registration, input.account.accessToken, buffer);
        mediaAssetUrn = registration.value.asset;
      }

      const body = {
        author: personUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: input.caption },
            shareMediaCategory,
            ...(mediaAssetUrn ? { media: [{ status: "READY", media: mediaAssetUrn }] } : {}),
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      };

      // Raw fetch (rather than the jsonRequest helper) because LinkedIn
      // returns the created post's id in the `x-restli-id` response header,
      // not in the JSON body.
      const response = await fetch(`${API_BASE}/ugcPosts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.account.accessToken}`, ...RESTLI_HEADERS },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const { errorCode, retryable } = classifyHttpStatus(response.status);
        const errorBody = await response.text();
        throw new PlatformApiError(errorBody || `LinkedIn post failed with status ${response.status}`, errorCode, retryable);
      }
      const externalPostId = response.headers.get("x-restli-id") ?? "";

      return {
        success: true,
        externalPostId,
        externalUrl: externalPostId ? `https://www.linkedin.com/feed/update/${externalPostId}` : undefined,
        retryable: false,
      };
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
