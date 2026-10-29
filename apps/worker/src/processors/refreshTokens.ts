import type { Job } from "bullmq";
import { prisma } from "@smm/db";
import { connectorRegistry } from "@smm/connectors";
import { decryptToken, encryptToken } from "@smm/auth";
import type { RefreshTokenJobData } from "@smm/queue";
import { notify } from "../lib/notifications";

const EXPIRY_WINDOW_MS = 24 * 60 * 60 * 1000;

async function refreshOne(accountId: string): Promise<void> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!account || account.status !== "ACTIVE") return;

  const connector = connectorRegistry.get(account.platform);
  try {
    const refreshed = await connector.refreshToken({
      socialAccountId: account.id,
      organizationId: account.organizationId,
      externalUserId: account.externalUserId,
      accessToken: decryptToken(account.accessToken),
      refreshToken: account.refreshToken ? decryptToken(account.refreshToken) : null,
      tokenExpiresAt: account.tokenExpiresAt,
      metadata: account.metadata as Record<string, unknown> | null,
    });
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        accessToken: encryptToken(refreshed.accessToken),
        refreshToken: refreshed.refreshToken ? encryptToken(refreshed.refreshToken) : account.refreshToken,
        tokenExpiresAt: refreshed.expiresAt ?? account.tokenExpiresAt,
      },
    });
  } catch (error) {
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { status: "EXPIRED", lastError: error instanceof Error ? error.message : String(error) },
    });
    await notify(
      account.organizationId,
      "TOKEN_EXPIRED",
      `${account.displayName} needs to be reconnected`,
      "This account's connection expired and couldn't be automatically refreshed. Reconnect it in Social Accounts.",
    );
  }
}

/** Proactively refreshes tokens nearing expiry so scheduled publishes don't fail on stale tokens. */
export async function processRefreshTokenSweep(): Promise<void> {
  const soon = new Date(Date.now() + EXPIRY_WINDOW_MS);
  const expiringAccounts = await prisma.socialAccount.findMany({
    where: { status: "ACTIVE", tokenExpiresAt: { not: null, lt: soon } },
  });
  for (const account of expiringAccounts) {
    await refreshOne(account.id);
  }
}

export async function processRefreshTokenJob(job: Job<RefreshTokenJobData>): Promise<void> {
  await refreshOne(job.data.socialAccountId);
}
