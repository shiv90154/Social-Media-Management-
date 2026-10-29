import Link from "next/link";
import { prisma } from "@smm/db";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@smm/ui";
import { getCurrentContext } from "@/lib/current-org";
import { updateOrganizationNameAction } from "@/lib/actions/settings";

export default async function SettingsPage() {
  const ctx = await getCurrentContext();
  const org = await prisma.organization.findUnique({ where: { id: ctx.organizationId } });

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your workspace.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateOrganizationNameAction} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Workspace name</Label>
              <Input id="name" name="name" defaultValue={org?.name} required />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Plan: <span className="font-medium capitalize">{org?.plan}</span>
            </div>
            <Button type="submit" className="w-fit">
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Developer</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            See which platform API credentials are configured on this deployment.
          </p>
          <Link href="/settings/developer">
            <Button variant="outline">Open Developer settings</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
