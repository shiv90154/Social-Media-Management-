"use server";

import { redirect } from "next/navigation";
import { prisma } from "@smm/db";
import { auth } from "@/auth";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "workspace"
  );
}

export async function createWorkspaceAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const orgName = String(formData.get("orgName") ?? "").trim() || "My Workspace";
  const baseSlug = slugify(orgName);
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix++}`;
  }

  const organization = await prisma.organization.create({ data: { name: orgName, slug } });
  await prisma.membership.create({
    data: { userId: session.user.id, organizationId: organization.id, role: "OWNER" },
  });

  redirect("/dashboard");
}
