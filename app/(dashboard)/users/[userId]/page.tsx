import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { getUserProfile } from "@/server/services/user-profile";
import { listUserResponsibilities } from "@/server/services/user-responsibility";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { DetailMetadataSection, DetailPageLayout } from "@/components/ui/detail-page-layout";
import { UserIdentityLink } from "@/components/ui/user-identity-link";
import { formatRelativeTime } from "@/lib/relative-time";
import { MembershipTree } from "./_components/membership-tree";
import { Responsibilities } from "./_components/responsibilities";
import { UserActivity } from "./_components/user-activity";
import { ProfileAdminActions } from "./_components/profile-admin-actions";

type Props = { params: Promise<{ userId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { userId } = await params;
  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, userId),
    columns: { name: true, username: true },
  });
  return { title: user?.name ?? user?.username ?? "User profile" };
}

export default async function UserProfilePage({ params }: Props) {
  const { userId: targetUserId } = await params;
  const session = await auth();
  const viewer = {
    userId: session!.user!.id!,
    systemRole: session!.user!.systemRole === "superadmin" ? "superadmin" as const : "user" as const,
  };
  const [profile, responsibilities] = await Promise.all([
    getUserProfile(targetUserId, viewer, db),
    listUserResponsibilities(targetUserId, viewer, { limit: 20 }, db),
  ]);
  if (!profile) notFound();

  const lastLogin = profile.user.lastLoginAt;
  const directMembershipCount =
    profile.summary.directOrganizations +
    profile.summary.directDepartments +
    profile.summary.directTeams;

  return (
    <DetailPageLayout
      breadcrumb={<Breadcrumb items={[{ label: "User profile" }, { label: profile.user.name ?? `@${profile.user.username}` }]} />}
      metadataLabel={`Details for ${profile.user.name ?? profile.user.email}`}
      metadata={
        <>
          <DetailMetadataSection title="Account">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="break-all">{profile.user.email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">System role</dt>
                <dd className="capitalize">{profile.user.systemRole}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Joined</dt>
                <dd title={profile.user.createdAt.toISOString()}>{profile.user.createdAt.toLocaleDateString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last login</dt>
                <dd title={lastLogin?.toISOString()}>
                  {lastLogin ? formatRelativeTime(lastLogin) : "Never signed in"}
                </dd>
              </div>
            </dl>
          </DetailMetadataSection>
          <DetailMetadataSection title="Memberships" count={directMembershipCount}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Organizations</dt><dd>{profile.summary.directOrganizations}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Departments</dt><dd>{profile.summary.directDepartments}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Teams</dt><dd>{profile.summary.directTeams}</dd></div>
            </dl>
          </DetailMetadataSection>
          {profile.admin && (
            <>
              <DetailMetadataSection title="Authentication">
                <div className="flex flex-wrap gap-1.5">
                  {profile.admin.authMethods.length
                    ? profile.admin.authMethods.map((method) => <Badge key={method} variant="outline">{method}</Badge>)
                    : <span className="text-sm text-muted-foreground">No sign-in method configured.</span>}
                </div>
              </DetailMetadataSection>
              <DetailMetadataSection title="Administration">
                <ProfileAdminActions
                  user={{
                    id: profile.user.id,
                    name: profile.user.name,
                    username: profile.user.username,
                    email: profile.user.email,
                    systemRole: profile.user.systemRole,
                    hasPassword: profile.admin.hasPassword,
                  }}
                  currentUserId={viewer.userId}
                />
              </DetailMetadataSection>
            </>
          )}
        </>
      }
    >
      <div className="space-y-8">
        <header className="space-y-3">
          <UserIdentityLink
            userId={profile.user.id}
            name={profile.user.name}
            username={profile.user.username}
            email={profile.user.email}
            image={profile.user.image}
            className="text-xl"
          />
          <div className="flex flex-wrap gap-2">
            <Badge variant={profile.user.systemRole === "superadmin" ? "default" : "outline"}>
              {profile.user.systemRole}
            </Badge>
            {profile.user.username && <Badge variant="secondary">@{profile.user.username}</Badge>}
          </div>
        </header>
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Organizations and teams</h2>
            <p className="text-sm text-muted-foreground">Direct memberships and inherited hierarchy.</p>
          </div>
          <MembershipTree memberships={profile.memberships} />
        </section>
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Current responsibilities</h2>
            <p className="text-sm text-muted-foreground">Visible assigned work and Workflow stages.</p>
          </div>
          <Responsibilities data={responsibilities} />
        </section>
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Activity</h2>
            <p className="text-sm text-muted-foreground">Actions performed by this user and events that affected them.</p>
          </div>
          <UserActivity userId={profile.user.id} isSuperAdmin={viewer.systemRole === "superadmin"} />
        </section>
      </div>
    </DetailPageLayout>
  );
}
