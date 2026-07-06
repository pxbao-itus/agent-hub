import type { Metadata } from "next";
import { auth } from "@/auth";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { auditEvents, users } from "@/server/db/schema";
import { desc, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRelativeTime } from "@/lib/relative-time";
import { ShieldCheck } from "lucide-react";

export const metadata: Metadata = { title: "Audit log" };

// Destructive actions get a louder badge than routine permission grants.
const ACTION_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  "artifact.delete": "default",
  "token.revoke": "default",
  "membership.remove": "default",
  "project.member.remove": "default",
};

function summarize(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const m = meta as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof m.title === "string") parts.push(m.title);
  if (typeof m.kind === "string") parts.push(`(${m.kind})`);
  if (typeof m.role === "string") parts.push(`role=${m.role}`);
  if (typeof m.name === "string") parts.push(m.name);
  if (typeof m.granteeUserId === "string") parts.push(`grantee=${m.granteeUserId.slice(0, 8)}`);
  if (typeof m.memberUserId === "string") parts.push(`user=${m.memberUserId.slice(0, 8)}`);
  return parts.join(" ");
}

export default async function AuditPage() {
  const session = await auth();
  if (session?.user?.systemRole !== "superadmin") notFound();

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditEvents)
    .leftJoin(users, eq(auditEvents.actorId, users.id))
    .orderBy(desc(auditEvents.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Security-relevant events — deletes, shares, permission changes, and token activity. Superadmin only.
          Ordinary content edits are tracked in each artifact&apos;s version history instead.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} variant="empty" message="No audit events yet." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground" title={r.createdAt.toISOString()}>
                    {formatRelativeTime(r.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    {r.actorName ?? r.actorEmail ?? <span className="text-muted-foreground">(deleted user)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={ACTION_VARIANT[r.action] ?? "secondary"} className="font-mono text-[10px]">
                      {r.action}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <span className="capitalize">{r.targetType}</span>
                    {summarize(r.metadata) && <span className="ml-1.5 text-foreground">{summarize(r.metadata)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
