import { Badge, type BadgeVariant } from "./badge";

const STATUS_CONFIG: Record<string, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: "Draft", variant: "muted" },
  SCHEDULED: { label: "Scheduled", variant: "default" },
  PUBLISHING: { label: "Publishing…", variant: "warning" },
  PUBLISHED: { label: "Published", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
  PARTIALLY_FAILED: { label: "Partially failed", variant: "warning" },
  CANCELLED: { label: "Cancelled", variant: "muted" },
  PENDING: { label: "Pending", variant: "muted" },
  QUEUED: { label: "Queued", variant: "default" },
  SKIPPED_UNSUPPORTED: { label: "Unsupported", variant: "muted" },
  ACTIVE: { label: "Active", variant: "success" },
  EXPIRED: { label: "Expired", variant: "warning" },
  REVOKED: { label: "Revoked", variant: "destructive" },
  ERROR: { label: "Error", variant: "destructive" },
  NOT_CONFIGURED: { label: "Not configured", variant: "muted" },
};

export function StatusChip({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: "muted" as BadgeVariant };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
