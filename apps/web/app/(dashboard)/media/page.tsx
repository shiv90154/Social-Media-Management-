import { prisma } from "@smm/db";
import { getCurrentContext } from "@/lib/current-org";
import { MediaGrid } from "@/components/media-grid";

export default async function MediaLibraryPage() {
  const ctx = await getCurrentContext();
  const assets = await prisma.mediaAsset.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Media Library</h1>
        <p className="text-sm text-muted-foreground">Upload once, reuse across any post.</p>
      </div>
      <MediaGrid initialAssets={assets} />
    </div>
  );
}
