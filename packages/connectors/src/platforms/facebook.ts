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
const SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"];

function env() {
  return {
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
  };
}

export class FacebookConnector implements PlatformConnector {
  readonly platform = "FACEBOOK" as const;

  isConfigured(): boolean {
    return REQUIRED_ENV.every((key) => Boolean(process.env[key]));
  }

  getCapabilities(): PlatformCapabilities {
    return {
      platform: this.platform,
      supportsPublishing: true,
      supportsNativeScheduling: true,
      supportsImage: true,
      supportsVideo: true,
      supportsGif: false,
      supportsCarousel: false,
      supportsTextOnly: true,
      supportsAnalytics: true,
      requiresBusinessAccount: false,
      maxCaptionLength: 63206,
      maxMediaCount: 1,
      maxImageSizeMB: 10,
      maxVideoSizeMB: 10240,
      maxVideoDurationSec: 14400,
      supportedAspectRatios: null,
      notes: [
        "Posts to a connected Facebook Page (not a personal profile).",
        "Facebook natively supports server-side scheduling, but this app schedules via its own queue for consistency across platforms.",
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
      throw new PlatformApiError("Facebook is not configured", "APP_NOT_APPROVED", false);
    }

    const tokenUrl = new URL(`${FACEBOOK_GRAPH_BASE}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);
    const shortLived = await jsonRequest<{ access_token: string; expires_in: number }>(tokenUrl.toString());

    const longLived = await exchangeForLongLivedToken(shortLived.access_token, appId, appSecret);

    const pages = await listManagedPages(longLived.access_token);
    if (pages.length === 0) {
      throw new PlatformApiError(
        "No Facebook Pages found. You must manage at least one Page to connect Facebook.",
        "VALIDATION_ERROR",
        false,
      );
    }
    // NOTE: connects the first managed Page. If the user manages several
    // Pages, the rest are listed in metadata.availablePages for a future
    // "switch connected page" UI affordance.
    const page = pages[0]!;

    return {
      externalUserId: page.id,
      displayName: page.name,
      accessToken: page.access_token,
      scopes: SCOPES,
      metadata: {
        availablePages: pages.map((p) => ({ id: p.id, name: p.name })),
        instagramBusinessAccountId: page.instagram_business_account?.id ?? null,
      },
    };
  }

  async refreshToken(account: SocialAccountCredentials): Promise<OAuthResult> {
    // Facebook Page access tokens derived from a long-lived user token don't
    // expire on a fixed schedule but can be invalidated; re-derive it from
    // the stored long-lived user token if we have one, otherwise the caller
    // must prompt the user to reconnect.
    throw new PlatformApiError(
      "Facebook page tokens don't auto-refresh; reconnect this account if it expires.",
      "TOKEN_EXPIRED",
      false,
    );
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const pageId = input.account.externalUserId;
    const captionIssues = validateCaptionLength(input.caption, this.getCapabilities());
    if (captionIssues.length > 0) {
      return { success: false, errorCode: "VALIDATION_ERROR", errorMessage: captionIssues[0]!.message, retryable: false };
    }

    try {
      const media = input.media[0];
      let result: { id?: string; post_id?: string };

      if (!media) {
        result = await graphRequest(FACEBOOK_GRAPH_BASE, `/${pageId}/feed`, input.account.accessToken, {
          method: "POST",
          body: new URLSearchParams({ message: input.caption }),
        });
      } else if (media.type === "image") {
        result = await graphRequest(FACEBOOK_GRAPH_BASE, `/${pageId}/photos`, input.account.accessToken, {
          method: "POST",
          body: new URLSearchParams({ url: media.url, caption: input.caption }),
        });
      } else {
        result = await graphRequest(FACEBOOK_GRAPH_BASE, `/${pageId}/videos`, input.account.accessToken, {
          method: "POST",
          body: new URLSearchParams({ file_url: media.url, description: input.caption }),
        });
      }

      const externalPostId = result.post_id ?? result.id ?? "";
      return {
        success: true,
        externalPostId,
        externalUrl: `https://www.facebook.com/${externalPostId}`,
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
      { params: { metric: "post_impressions,post_engaged_users,post_reactions_like_total" } },
    );
    const metrics: Record<string, number> = {};
    for (const item of result.data) {
      metrics[item.name] = item.values[0]?.value ?? 0;
    }
    return metrics;
  }

  async disconnect(): Promise<void> {
    // Facebook has no explicit "revoke" call needed from our side for Page
    // tokens beyond deleting the stored SocialAccount row; the user can also
    // revoke app access from their Facebook settings.
  }
}
