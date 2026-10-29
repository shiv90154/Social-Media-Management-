import { prisma } from "@smm/db";
import { connectorRegistry } from "@smm/connectors";
import { getCurrentContext } from "@/lib/current-org";
import { PostComposer } from "@/components/post-composer";

export default async function CreatePostPage() {
  const ctx = await getCurrentContext();

  const [accounts, media] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { organizationId: ctx.organizationId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mediaAsset.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      take: 24,
    }),
  ]);

  const capabilities = Object.fromEntries(
    connectorRegistry.all().map((connector) => [connector.platform, connector.getCapabilities()]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create Post</h1>
        <p className="text-sm text-muted-foreground">Write once, customize per platform, publish everywhere.</p>
      </div>
      <PostComposer
        accounts={accounts.map((a) => ({
          id: a.id,
          platform: a.platform,
          displayName: a.displayName,
          handle: a.handle,
        }))}
        initialMedia={media}
        capabilities={capabilities}
      />
    </div>
  );
}
