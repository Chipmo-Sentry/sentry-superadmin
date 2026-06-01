import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@chipmo-sentry/ui-kit";
import { Building2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Field } from "@/components/Field";
import { admin } from "@/lib/api";
import type { OrganizationPublic } from "@/lib/types";

export function OrgsPage() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<OrganizationPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  async function reload() {
    try {
      setOrgs(await admin.listOrgs());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Байгууллагууд</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Шинэ байгууллага
        </Button>
      </div>

      {error && <p className="text-[var(--color-danger)]">{error}</p>}

      {orgs === null && !error ? (
        <Spinner />
      ) : orgs && orgs.length === 0 ? (
        <Card>
          <CardContent className="py-10">
            <EmptyState
              icon={Building2}
              title="Байгууллага алга"
              description="Эхний байгууллагаа үүсгэнэ үү."
            />
          </CardContent>
        </Card>
      ) : orgs ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Нэр</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Үүсгэсэн</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((o) => (
                  <TableRow
                    key={o.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/orgs/${o.id}`)}
                  >
                    <TableCell className="font-medium">{o.name}</TableCell>
                    <TableCell>
                      <Badge tone="neutral">{o.slug}</Badge>
                    </TableCell>
                    <TableCell className="text-[var(--color-muted-foreground)]">
                      {new Date(o.created_at).toLocaleDateString("mn-MN")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <CreateOrgModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          void reload();
        }}
      />
    </div>
  );
}

function CreateOrgModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setSlug("");
      setError(null);
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await admin.createOrg({ name: name.trim(), slug: slug.trim() });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Үүсгэж чадсангүй");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Шинэ байгууллага</ModalTitle>
        </ModalHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <Field label="Нэр" required>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Жишээ: Номин Холдинг"
              disabled={saving}
            />
          </Field>
          <Field
            label="Slug"
            required
            hint="Зөвхөн жижиг үсэг, тоо, зураас (a-z, 0-9, -)"
          >
            <Input
              required
              pattern="[a-z0-9][a-z0-9-]*"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="nomin-holding"
              disabled={saving}
            />
          </Field>
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Болих
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || !slug.trim()}>
              {saving ? "Хадгалж байна…" : "Үүсгэх"}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
