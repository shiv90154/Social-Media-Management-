import { connectorRegistry, type PlatformType } from "@smm/connectors";
import { Card, CardContent, PlatformIcon, StatusChip, PLATFORM_META } from "@smm/ui";
import { PLATFORM_DOCS_URL, PLATFORM_ENV_VARS } from "@/lib/platform-docs";

export default function DeveloperSettingsPage() {
  const platforms = Object.keys(PLATFORM_META) as PlatformType[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Developer</h1>
        <p className="text-sm text-muted-foreground">
          Platform API credentials are set as environment variables on this deployment (see{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.example</code> at the repo root). A platform
          shown as &quot;Not configured&quot; is safely disabled everywhere in the app until its variables are set.
        </p>
      </div>

      <Card>
        <CardContent className="overflow-x-auto pt-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 pr-4">Platform</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Required environment variables</th>
                <th className="pb-2 pr-4">Docs</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((platform) => {
                const configured = connectorRegistry.get(platform).isConfigured();
                return (
                  <tr key={platform} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <PlatformIcon platform={platform} />
                        {PLATFORM_META[platform].label}
                      </div>
                    </td>
                    <td className="py-2 pr-4">
                      <StatusChip status={configured ? "ACTIVE" : "NOT_CONFIGURED"} />
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-col gap-0.5">
                        {PLATFORM_ENV_VARS[platform].map((v) => (
                          <code key={v} className="text-xs text-muted-foreground">
                            {v}
                          </code>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-4">
                      <a
                        href={PLATFORM_DOCS_URL[platform]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        API docs
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
