import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@smm/ui";
import { createWorkspaceAction } from "@/lib/actions/onboarding";

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your workspace</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createWorkspaceAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="orgName">Workspace name</Label>
              <Input id="orgName" name="orgName" placeholder="Acme Inc." required />
            </div>
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
