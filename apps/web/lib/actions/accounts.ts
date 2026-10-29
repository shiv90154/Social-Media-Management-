"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@smm/db";
import { connectorRegistry } from "@smm/connectors";
import { decryptToken } from "@smm/auth";
import { getCurrentContext } from "@/lib/current-org";

export async function disconnectAccountAction(socialAccountId: string) {
  const ctx = await getCurrentContext();
  const account = await prisma.socialAccount.findFirst({
    where: { id: socialAccountId, organizationId: ctx.organizationId },
  });
  if (!account) return;

  const connector = connectorRegistry.get(account.platform);
  try {
    await connector.disconnect({
      socialAccountId: account.id,
      organizationId: account.organizationId,
      externalUserId: account.externalUserId,
      accessToken: decryptToken(account.accessToken),
      metadata: account.metadata as Record<string, unknown> | null,
    });
  } catch {
    // Best-effort — still remove our local record even if the platform-side
    // revoke call fails (e.g. token already invalid).
  }

  await prisma.socialAccount.delete({ where: { id: account.id } });
  revalidatePath("/accounts");
}
