import { prisma } from "@smm/db";
import { connectorRegistry } from "@smm/connectors";
import { decryptToken } from "@smm/auth";

const LOOKBACK_DAYS = 30;

/** Sweeps recently-published PostTargets and records a fresh AnalyticsSnapshot for each, where the platform exposes it. */
export async function processAnalyticsSweep(): Promise<void> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const targets = await prisma.postTarget.findMany({
    where: { status: "PUBLISHED", publishedAt: { gte: since }, externalPostId: { not: null } },
    include: { socialAccount: true },
  });

  for (const target of targets) {
    const connector = connectorRegistry.get(target.platform);
    if (!connector.getCapabilities().supportsAnalytics || !target.externalPostId) continue;

    try {
      const metrics = await connector.getAnalytics(target.externalPostId, {
        socialAccountId: target.socialAccount.id,
        organizationId: target.socialAccount.organizationId,
        externalUserId: target.socialAccount.externalUserId,
        accessToken: decryptToken(target.socialAccount.accessToken),
        refreshToken: target.socialAccount.refreshToken ? decryptToken(target.socialAccount.refreshToken) : null,
        tokenExpiresAt: target.socialAccount.tokenExpiresAt,
        metadata: target.socialAccount.metadata as Record<string, unknown> | null,
      });
      if (Object.keys(metrics).length > 0) {
        await prisma.analyticsSnapshot.create({ data: { postTargetId: target.id, metrics } });
      }
    } catch {
      // Analytics fetches are best-effort and run on a schedule; a
      // transient failure for one target just waits for the next sweep.
    }
  }
}
