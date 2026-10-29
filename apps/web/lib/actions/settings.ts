"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@smm/db";
import { getCurrentContext } from "@/lib/current-org";

export async function updateOrganizationNameAction(formData: FormData) {
  const ctx = await getCurrentContext();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await prisma.organization.update({ where: { id: ctx.organizationId }, data: { name } });
  revalidatePath("/settings");
}
