import type { MediaValidationIssue, PlatformCapabilities, PublishMediaInput } from "../types";

/**
 * Shared media validation every connector's validateMedia() delegates to.
 * Runs both client-side (compose-time warnings) and again in the worker
 * (defensive re-check) — never trust only one side.
 */
export function validateMediaAgainstCapabilities(
  media: PublishMediaInput[],
  caps: PlatformCapabilities,
): MediaValidationIssue[] {
  const issues: MediaValidationIssue[] = [];

  if (media.length === 0 && !caps.supportsTextOnly) {
    issues.push({
      errorCode: "UNSUPPORTED_MEDIA",
      message: `${caps.platform} requires at least one media attachment.`,
    });
    return issues;
  }

  if (media.length > caps.maxMediaCount) {
    issues.push({
      errorCode: "UNSUPPORTED_MEDIA",
      message: `${caps.platform} allows at most ${caps.maxMediaCount} media item(s) per post.`,
    });
  }

  if (media.length > 1 && !caps.supportsCarousel) {
    issues.push({
      errorCode: "UNSUPPORTED_MEDIA",
      message: `${caps.platform} doesn't support multi-image/carousel posts.`,
    });
  }

  for (const item of media) {
    if (item.type === "image" && !caps.supportsImage) {
      issues.push({ errorCode: "UNSUPPORTED_MEDIA", message: `${caps.platform} doesn't support images.` });
    }
    if (item.type === "video" && !caps.supportsVideo) {
      issues.push({ errorCode: "UNSUPPORTED_MEDIA", message: `${caps.platform} doesn't support video.` });
    }
    if (item.type === "gif" && !caps.supportsGif) {
      issues.push({ errorCode: "UNSUPPORTED_MEDIA", message: `${caps.platform} doesn't support GIFs.` });
    }

    const sizeMB = item.sizeBytes ? item.sizeBytes / (1024 * 1024) : undefined;
    if (item.type === "image" && sizeMB && caps.maxImageSizeMB && sizeMB > caps.maxImageSizeMB) {
      issues.push({
        errorCode: "UNSUPPORTED_MEDIA",
        message: `Image exceeds ${caps.platform}'s ${caps.maxImageSizeMB}MB limit.`,
      });
    }
    if (item.type === "video" && sizeMB && caps.maxVideoSizeMB && sizeMB > caps.maxVideoSizeMB) {
      issues.push({
        errorCode: "UNSUPPORTED_MEDIA",
        message: `Video exceeds ${caps.platform}'s ${caps.maxVideoSizeMB}MB limit.`,
      });
    }
    if (
      item.type === "video" &&
      item.durationSec &&
      caps.maxVideoDurationSec &&
      item.durationSec > caps.maxVideoDurationSec
    ) {
      issues.push({
        errorCode: "UNSUPPORTED_MEDIA",
        message: `Video exceeds ${caps.platform}'s ${caps.maxVideoDurationSec}s duration limit.`,
      });
    }
  }

  return issues;
}

export function validateCaptionLength(
  caption: string,
  caps: PlatformCapabilities,
): MediaValidationIssue[] {
  if (caps.maxCaptionLength !== null && caption.length > caps.maxCaptionLength) {
    return [
      {
        errorCode: "VALIDATION_ERROR",
        message: `Caption exceeds ${caps.platform}'s ${caps.maxCaptionLength}-character limit.`,
      },
    ];
  }
  return [];
}
