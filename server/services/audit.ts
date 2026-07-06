import { auditEvents } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

/**
 * Security-relevant audit actions. Deliberately NOT covering ordinary
 * artifact create/update — those are already traceable via artifact_versions
 * (createdBy per version). Audit records what version history can't: deletes,
 * shares, permission/role changes, and token issuance/revocation.
 */
export type AuditAction =
  | "artifact.delete"
  | "share.grant"
  | "share.revoke"
  | "membership.add"
  | "membership.remove"
  | "membership.role"
  | "user.role"
  | "token.create"
  | "token.revoke"
  | "project.member.add"
  | "project.member.remove";

export type AuditEntry = {
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Append one audit event. Awaited by callers (a write path, not the hot read
 * path — same deliberate choice as notifyVersionChange, D-024): a failure to
 * record should surface, not be silently swallowed.
 */
export async function recordAudit(entry: AuditEntry, db: DbClient): Promise<void> {
  await db.insert(auditEvents).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? null,
  });
}
