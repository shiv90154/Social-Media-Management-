import { getCurrentContext } from "@/lib/current-org";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentContext();
  return <DashboardShell organizationName={ctx.organizationName}>{children}</DashboardShell>;
}
