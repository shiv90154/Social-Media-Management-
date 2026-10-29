import { prisma, type NotificationType } from "@smm/db";

export async function notify(
  organizationId: string,
  type: NotificationType,
  title: string,
  body: string,
  relatedPostId?: string,
) {
  await prisma.notification.create({
    data: { organizationId, type, title, body, relatedPostId },
  });
}
