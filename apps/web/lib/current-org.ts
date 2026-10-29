import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@smm/db";
import { auth } from "@/auth";

export interface CurrentContext {
  userId: string;
  organizationId: string;
  organizationName: string;
  role: string;
}

/**
 * Resolves the signed-in user's active organization. Every tenant-scoped
 * data access in this app goes through this helper (or is filtered by the
 * organizationId it returns) — never trust an organizationId supplied by
 * the client directly.
 */
export async function getCurrentContext(): Promise<CurrentContext> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const cookieStore = cookies();
  const preferredOrgId = cookieStore.get("smm_org_id")?.value;

  const memberships = await prisma.membership.findMany({
    where: { userId: session.user.id },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) {
    redirect("/onboarding");
  }

  const active =
    memberships.find((m) => m.organizationId === preferredOrgId) ?? memberships[0]!;

  return {
    userId: session.user.id,
    organizationId: active.organizationId,
    organizationName: active.organization.name,
    role: active.role,
  };
}
