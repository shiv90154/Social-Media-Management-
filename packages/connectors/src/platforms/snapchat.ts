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
import { PlatformApiError, jsonRequest } from "../shared/http";

const REQUIRED_ENV = ["SNAPCHAT_CLIENT_ID", "SNAPCHAT_CLIENT_SECRET"] as const;
const SCOPES = ["snapchat-marketing-api"];

function env() {
  return { clientId: process.env.SNAPCHAT_CLIENT_ID, clientSecret: process.env.SNAPCHAT_CLIENT_SECRET };
}

/**
 * Snapchat has no public API for unattended/background organic posting.
 * Its Marketing API is ads-only, and Creative Kit only opens the Snapchat
 * app for a user-initiated share (a manual tap), which this backend worker
 * cannot trigger. This connector implements auth + capability flags
 * honestly so the app can show accurate account info, but publish() never
 * claims automated success — it always returns a clear NOT_SUPPORTED result.
 */
export class SnapchatConnector implements PlatformConnector {
  readonly platform = "SNAPCHAT" as const;

  isConfigured(): boolean {
    return REQUIRED_ENV.every((key) => Boolean(process.env[key]));
  }

  getCapabilities(): PlatformCapabilities {
    return {
      platform: this.platform,
      supportsPublishing: false,
      supportsNativeScheduling: false,
      supportsImage: false,
      supportsVideo: false,
      supportsGif: false,
      supportsCarousel: false,
      supportsTextOnly: false,
      supportsAnalytics: false,
      requiresBusinessAccount: false,
      maxCaptionLength: null,
      maxMediaCount: 0,
      maxImageSizeMB: null,
      maxVideoSizeMB: null,
      maxVideoDurationSec: null,
      supportedAspectRatios: null,
      notes: [
        "Snapchat has no public API for automated/unattended posting to a personal Story. This app can connect your account for identification purposes only.",
        "Content can still be sent to Snapchat manually via Snapchat's own share sheet on your device — this app cannot trigger that in the background.",
      ],
    };
  }

  validateMedia(_media: PublishMediaInput[]): MediaValidationIssue[] {
    return [
      {
        errorCode: "NOT_SUPPORTED",
        message: "Automated publishing to Snapchat isn't available through Snapchat's public API.",
      },
    ];
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const { clientId } = env();
    const url = new URL("https://accounts.snapchat.com/login/oauth2/authorize");
    url.searchParams.set("client_id", clientId ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  }

  async handleOAuthCallback(code: string, redirectUri: string): Promise<OAuthResult> {
    const { clientId, clientSecret } = env();
    if (!clientId || !clientSecret) {
      throw new PlatformApiError("Snapchat is not configured", "APP_NOT_APPROVED", false);
    }
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const token = await jsonRequest<{ access_token: string; refresh_token?: string; expires_in: number }>(
      "https://accounts.snapchat.com/login/oauth2/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      },
    );

    const profile = await jsonRequest<{ me: { display_name: string; external_id: string } }>(
      "https://kit.snapchat.com/v1/me",
      { bearerToken: token.access_token },
    ).catch(() => ({ me: { display_name: "Snapchat account", external_id: "unknown" } }));

    return {
      externalUserId: profile.me.external_id,
      displayName: profile.me.display_name,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: SCOPES,
    };
  }

  async refreshToken(): Promise<OAuthResult> {
    throw new PlatformApiError("Reconnect this Snapchat account", "TOKEN_EXPIRED", false);
  }

  async publish(_input: PublishInput): Promise<PublishResult> {
    return {
      success: false,
      errorCode: "NOT_SUPPORTED",
      errorMessage:
        "Snapchat doesn't offer a public API for automated posting. Share this content to Snapchat manually from your device.",
      retryable: false,
    };
  }

  async getAnalytics(): Promise<Record<string, number>> {
    return {};
  }

  async disconnect(_account: SocialAccountCredentials): Promise<void> {}
}
