import { NextResponse } from "next/server";
import { prisma } from "@smm/db";
import { getCurrentContext } from "@/lib/current-org";

export async function GET() {
  const ctx = await getCurrentContext();
  const notifications = await prisma.notification.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ notifications });
}

export async function PATCH(request: Request) {
  const ctx = await getCurrentContext();
  const { id } = (await request.json()) as { id: string };
  await prisma.notification.updateMany({
    where: { id, organizationId: ctx.organizationId },
    data: { read: true },
  });
  return NextResponse.json({ ok: true });
}
