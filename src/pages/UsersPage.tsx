import {
  Badge,
  Button,
  Card,
  CardContent,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
  Field,
  Input,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@chipmo-sentry/ui-kit";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { admin } from "@/lib/api";
import type { OrganizationPublic, OrgRole, UserPublic } from "@/lib/types";

const ROLES: { value: OrgRole; label: string }[] = [
  { value: "owner", label: "Эзэмшигч (owner)" },
  { value: "admin", label: "Админ (admin)" },
  { value: "staff", label: "Ажилтан (staff)" },
];

export function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserPublic[] | null>(null);
  const [orgs, setOrgs] = useState<OrganizationPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  async function reload() {
    try {
      const [u, o] = await Promise.all([admin.listUsers(), admin.listOrgs()]);
      setUsers(u);
      setOrgs(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function patch(u: UserPublic, body: Parameters<typeof admin.updateUser>[1]) {
    try {
      await admin.updateUser(u.id, body);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Шинэчилж чадсангүй");
    }
  }

  const myId = me ? me.id : "";

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Хэрэглэгчид</h1>
        <Button
          size="sm"
          onClick={() => setInviteOpen(true)}
          disabled={orgs.length === 0}
        >
          <UserPlus className="h-4 w-4" />
          Хэрэглэгч урих
        </Button>
      </div>

      {error && <p className="text-[var(--color-danger)]">{error}</p>}

      {users === null && !error ? (
        <Spinner />
      ) : users ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>И-мэйл</TableHead>
                  <TableHead>Эрх</TableHead>
                  <TableHead>Төлөв</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isSelf = u.id === myId;
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.email}
                        {isSelf && (
                          <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">
                            (та)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.is_super_admin ? (
                          <Badge tone="notify">Супер админ</Badge>
                        ) : (
                          <Badge tone="neutral">Хэрэглэгч</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.is_active ? (
                          <Badge tone="success">Идэвхтэй</Badge>
                        ) : (
                          <Badge tone="danger">Идэвхгүй</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Dropdown>
                          <DropdownTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isSelf}
                              aria-label="Үйлдэл"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownTrigger>
                          <DropdownContent align="end">
                            <DropdownItem
                              onSelect={() =>
                                void patch(u, { is_active: !u.is_active })
                              }
                            >
                              {u.is_active ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
                            </DropdownItem>
                            <DropdownItem
                              onSelect={() =>
                                void patch(u, {
                                  is_super_admin: !u.is_super_admin,
                                })
                              }
                            >
                              {u.is_super_admin
                                ? "Супер админ цуцлах"
                                : "Супер админ болгох"}
                            </DropdownItem>
                          </DropdownContent>
                        </Dropdown>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <InviteUserModal
        open={inviteOpen}
        orgs={orgs}
        onClose={() => setInviteOpen(false)}
        onSaved={() => {
          setInviteOpen(false);
          void reload();
        }}
      />
    </div>
  );
}

function InviteUserModal({
  open,
  orgs,
  onClose,
  onSaved,
}: {
  open: boolean;
  orgs: OrganizationPublic[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState<OrgRole>("staff");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setPassword("");
    setOrgId(orgs[0]?.id ?? "");
    setRole("staff");
    setIsSuperAdmin(false);
    setError(null);
  }, [open, orgs]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await admin.inviteUser({
        email: email.trim(),
        password,
        organization_id: orgId,
        role,
        is_super_admin: isSuperAdmin,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Урьж чадсангүй");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Хэрэглэгч урих</ModalTitle>
        </ModalHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <Field label="И-мэйл" required>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="хэрэглэгч@chipmo.mn"
              disabled={saving}
              autoComplete="off"
            />
          </Field>
          <Field label="Нууц үг" required hint="Хамгийн багадаа 8 тэмдэгт">
            <Input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={saving}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Байгууллага" required>
            <Select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              required
              disabled={saving}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Эрх" required>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
              disabled={saving}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isSuperAdmin}
              onChange={(e) => setIsSuperAdmin(e.target.checked)}
              disabled={saving}
              className="h-4 w-4"
            />
            Супер админ эрх олгох
          </label>
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Болих
            </Button>
            <Button
              type="submit"
              disabled={saving || !email.trim() || password.length < 8 || !orgId}
            >
              {saving ? "Урьж байна…" : "Урих"}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
