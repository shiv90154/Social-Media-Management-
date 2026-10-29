import { prisma } from "@smm/db";
import { connectorRegistry, type PlatformType } from "@smm/connectors";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, PlatformIcon, PLATFORM_META, StatusChip } from "@smm/ui";
import { getCurrentContext } from "@/lib/current-org";
import { disconnectAccountAction } from "@/lib/actions/accounts";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string };
}) {
  const ctx = await getCurrentContext();
  const accounts = await prisma.socialAccount.findMany({ where: { organizationId: ctx.organizationId } });
  const accountsByPlatform = new Map(accounts.map((a) => [a.platform, a]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Social Accounts</h1>
        <p className="text-sm text-muted-foreground">Connect the platforms you want to publish to.</p>
      </div>

      {searchParams.connected && (
        <p className="rounded-md bg-emerald-500/10 px-4 py-2 text-sm text-emerald-600">
          Connected {searchParams.connected} successfully.
        </p>
      )}
      {searchParams.error && (
        <p className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">
          Couldn&apos;t connect: {searchParams.error.replace(/_/g, " ")}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(PLATFORM_META) as PlatformType[]).map((platform) => {
          const connector = connectorRegistry.get(platform);
          const configured = connector.isConfigured();
          const account = accountsByPlatform.get(platform);
          const caps = connector.getCapabilities();

          return (
            <Card key={platform}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                  <PlatformIcon platform={platform} className="h-5 w-5" />
                  <CardTitle>{PLATFORM_META[platform].label}</CardTitle>
                </div>
                {account ? (
                  <StatusChip status={account.status} />
                ) : (
                  !configured && <StatusChip status="NOT_CONFIGURED" />
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {account ? (
                  <>
                    <p className="text-sm font-medium">{account.displayName}</p>
                    {account.handle && <p className="text-xs text-muted-foreground">{account.handle}</p>}
                    {account.lastError && <p className="text-xs text-destructive">{account.lastError}</p>}
                    <form action={disconnectAccountAction.bind(null, account.id)}>
                      <Button type="submit" variant="outline" size="sm">
                        Disconnect
                      </Button>
                    </form>
                  </>
                ) : configured ? (
                  <a href={`/api/oauth/${platform.toLowerCase()}/connect`}>
                    <Button size="sm">Connect {PLATFORM_META[platform].label}</Button>
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Ask your admin to add {PLATFORM_META[platform].label} API credentials in Settings → Developer.
                  </p>
                )}
                {!caps.supportsPublishing && (
                  <Badge variant="warning" className="w-fit">
                    Limited support
                  </Badge>
                )}
                {caps.notes.length > 0 && (
                  <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {caps.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
