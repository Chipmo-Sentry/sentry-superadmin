import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@chipmo-sentry/ui-kit";
import { ArrowLeft, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { admin } from "@/lib/api";
import type { OrganizationPublic, OrgMemberPublic, OrgRole } from "@/lib/types";

const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Эзэмшигч",
  admin: "Админ",
  staff: "Ажилтан",
};

export function OrgDetailPage() {
  const { orgId = "" } = useParams();
  const [org, setOrg] = useState<OrganizationPublic | null>(null);
  const [members, setMembers] = useState<OrgMemberPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([admin.getOrg(orgId), admin.listOrgMembers(orgId)])
      .then(([o, m]) => {
        setOrg(o);
        setMembers(m);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Алдаа"));
  }, [orgId]);

  return (
    <div className="space-y-6 p-8">
      <Link
        to="/orgs"
        className="inline-flex items-center gap-1.5 text-sm text-(--color-muted-foreground) hover:text-(--color-foreground)"
      >
        <ArrowLeft className="h-4 w-4" />
        Байгууллагууд руу
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{org?.name ?? "Байгууллага"}</h1>
        {org && <Badge tone="neutral">{org.slug}</Badge>}
      </div>

      {error && <p className="text-(--color-danger)">{error}</p>}

      <Card>
        <CardContent className="p-0">
          {members === null && !error ? (
            <div className="p-6">
              <Spinner />
            </div>
          ) : members && members.length === 0 ? (
            <div className="py-10">
              <EmptyState
                icon={Users}
                title="Гишүүн алга"
                description="Энэ байгууллагад хараахан хэрэглэгч нэмээгүй байна."
              />
            </div>
          ) : members ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>И-мэйл</TableHead>
                  <TableHead>Эрх</TableHead>
                  <TableHead>Төлөв</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map(({ user, role }) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>
                      <Badge tone="neutral">{ROLE_LABEL[role]}</Badge>
                    </TableCell>
                    <TableCell>
                      {user.is_active ? (
                        <Badge tone="success">Идэвхтэй</Badge>
                      ) : (
                        <Badge tone="danger">Идэвхгүй</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
