import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ProfileMembershipOrg } from "@/server/services/user-profile";

function MembershipLabel({
  direct,
}: {
  direct: ProfileMembershipOrg["direct"];
}) {
  return direct ? (
    <div className="flex items-center gap-1.5">
      <Badge variant={direct.role === "admin" ? "default" : "outline"}>{direct.role}</Badge>
      <span className="text-xs text-muted-foreground">Direct</span>
    </div>
  ) : (
    <span className="text-xs text-muted-foreground">Inherited</span>
  );
}

function GroupName({ name, href }: { name: string; href: string | null }) {
  return href ? (
    <Link href={href} className="font-medium hover:underline">{name}</Link>
  ) : (
    <span className="font-medium">{name}</span>
  );
}

export function MembershipTree({ memberships }: { memberships: ProfileMembershipOrg[] }) {
  if (memberships.length === 0) {
    return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No memberships yet.</p>;
  }
  return (
    <div className="space-y-4">
      {memberships.map((org) => (
        <section key={org.id} className="rounded-lg border">
          <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
            <GroupName name={org.name} href={org.href} />
            <MembershipLabel direct={org.direct} />
          </div>
          {org.departments.length > 0 && (
            <div className="divide-y px-4">
              {org.departments.map((department) => (
                <div key={department.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <GroupName name={department.name} href={department.href} />
                    <MembershipLabel direct={department.direct} />
                  </div>
                  {department.teams.length > 0 && (
                    <div className="mt-2 space-y-2 border-l pl-4">
                      {department.teams.map((team) => (
                        <div key={team.id} className="flex items-center justify-between gap-3 text-sm">
                          <GroupName name={team.name} href={team.href} />
                          <MembershipLabel direct={team.direct} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
