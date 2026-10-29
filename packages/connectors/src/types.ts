import type { PlatformType } from "@smm/db";

export type { PlatformType };

/**
 * What a platform can and cannot do. The compose UI reads this to enable,
 * disable, or hide controls per platform — capability flags are the
 * contract for unsupported features, never a silent failure at publish time.
 */
export interface PlatformCapabilities {
  platform: PlatformType;
  /** True if this connector can actually publish content unattended. */
  supportsPublishing: boolean;
  supportsNativeScheduling: boolean;
  supportsImage: boolean;
  supportsVideo: boolean;
  supportsGif: boolean;
  supportsCarousel: boolean;
  supportsTextOnly: boolean;
  supportsAnalytics: boolean;
  requiresBusinessAccount: boolean;
  /** Null means "not applicable / no limit enforced by this connector". */
  maxCaptionLength: number | null;
  maxMediaCount: number;
  maxImageSizeMB: number | null;
  maxVideoSizeMB: number | null;
  maxVideoDurationSec: number | null;
  supportedAspectRatios: string[] | null;
  /** Human-readable caveats surfaced as UI tooltips/banners. */
  notes: string[];
}

export interface SocialAccountCredentials {
  socialAccountId: string;
  organizationId: string;
  externalUserId: string;
  /** Already decrypted by the caller (packages/auth's decryptToken). */
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface OAuthResult {
  externalUserId: string;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
  /** Plaintext — the caller encrypts before persisting. */
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  metadata?: Record<string, unknown>;
}

export type MediaKind = "image" | "video" | "gif";

export interface PublishMediaInput {
  url: string;
  type: MediaKind;
  mimeType: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface PublishInput {
  postTargetId: string;
  account: SocialAccountCredentials;
  caption: string;
  media: PublishMediaInput[];
}

export type PublishErrorCode =
  | "TOKEN_EXPIRED"
  | "UNSUPPORTED_MEDIA"
  | "RATE_LIMITED"
  | "APP_NOT_APPROVED"
  | "VALIDATION_ERROR"
  | "NOT_SUPPORTED"
  | "UNKNOWN";

export interface PublishResult {
  success: boolean;
  externalPostId?: string;
  externalUrl?: string;
  errorCode?: PublishErrorCode;
  errorMessage?: string;
  /** Whether the worker should retry this via BullMQ backoff. */
  retryable: boolean;
}

export interface MediaValidationIssue {
  message: string;
  errorCode: PublishErrorCode;
}

/**
 * Every platform integration implements this interface. The web app calls
 * getAuthUrl/handleOAuthCallback/disconnect during account connection, and
 * the worker calls refreshToken/publish/getAnalytics during the scheduling
 * pipeline. isConfigured() drives graceful degradation when the admin hasn't
 * supplied that platform's env vars yet.
 */
export interface PlatformConnector {
  readonly platform: PlatformType;

  /** True if this connector's required env vars are all present. */
  isConfigured(): boolean;

  getCapabilities(): PlatformCapabilities;

  /** Validates proposed media against this platform's capabilities before publish. */
  validateMedia(media: PublishMediaInput[]): MediaValidationIssue[];

  getAuthUrl(state: string, redirectUri: string): string;

  /**
   * `state` is passed through so PKCE-based connectors (e.g. X) can
   * re-derive their code_verifier without needing separate server-side
   * storage between the redirect and the callback.
   */
  handleOAuthCallback(code: string, redirectUri: string, state?: string): Promise<OAuthResult>;

  refreshToken(account: SocialAccountCredentials): Promise<OAuthResult>;

  publish(input: PublishInput): Promise<PublishResult>;

  getAnalytics(
    externalPostId: string,
    account: SocialAccountCredentials,
  ): Promise<Record<string, number>>;

  disconnect(account: SocialAccountCredentials): Promise<void>;
}

/** Human-friendly copy for each machine error code, shown in the Posts UI. */
export const PUBLISH_ERROR_MESSAGES: Record<PublishErrorCode, string> = {
  TOKEN_EXPIRED: "This account's connection expired. Reconnect it in Social Accounts.",
  UNSUPPORTED_MEDIA: "This platform doesn't support the media you attached.",
  RATE_LIMITED: "The platform's API rate limit was hit. It will retry automatically.",
  APP_NOT_APPROVED:
    "Publishing isn't approved for this app yet on this platform (see Settings > Developer).",
  VALIDATION_ERROR: "The platform rejected this post's content.",
  NOT_SUPPORTED: "This platform doesn't support automated publishing for this action.",
  UNKNOWN: "Something went wrong publishing to this platform.",
};
