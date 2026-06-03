import {
  Badge,
  Button,
  Card,
  CardContent,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
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
import { Cpu, Download, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { Field } from "@/components/Field";
import { admin } from "@/lib/api";
import type { AiNodePairingCode, AiNodePublic } from "@/lib/types";

const PROVIDERS = ["minicpm-v-2.6", "qwen2.5-vl-7b"];
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

/** Latest published AI server installer (GitHub Releases). `latest/download`
 * always resolves to the newest release asset, so this never needs bumping. */
const AI_SETUP_DOWNLOAD_URL =
  "https://github.com/Chipmo-Sentry/sentry-ai/releases/latest/download/ChipmoSentryAi-Setup.exe";

const selectClass =
  "h-10 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm disabled:opacity-50";

function isOnline(node: AiNodePublic): boolean {
  if (!node.last_seen_at) return false;
  const t = new Date(node.last_seen_at).getTime();
  return !Number.isNaN(t) && Date.now() - t < ONLINE_WINDOW_MS;
}

function telemetrySummary(raw: string | null): string {
  if (!raw) return "—";
  try {
    const t = JSON.parse(raw) as Record<string, unknown>;
    const parts: string[] = [];
    if (t.fps_inference != null) parts.push(`${Number(t.fps_inference).toFixed(1)} FPS`);
    if (t.vram_mb != null) parts.push(`${t.vram_mb} MB VRAM`);
    if (t.active_cameras != null) parts.push(`${t.active_cameras} камер`);
    return parts.length ? parts.join(" · ") : "—";
  } catch {
    return "—";
  }
}

export function AiNodesPage() {
  const [nodes, setNodes] = useState<AiNodePublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<AiNodePairingCode | null>(null);
  const [editing, setEditing] = useState<AiNodePublic | null>(null);

  async function reload() {
    try {
      setNodes(await admin.listAiNodes());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function generateCode() {
    try {
      setPairing(await admin.createAiNodePairingCode());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Код үүсгэж чадсангүй");
    }
  }

  async function revoke(node: AiNodePublic) {
    try {
      await admin.revokeAiNode(node.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Цуцалж чадсангүй");
    }
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">AI сервер (compute node)</h1>
        <div className="flex items-center gap-3">
          <Button
            asChild
            size="sm"
            variant="outline"
            title="Windows .exe — AI серверийн хамгийн сүүлийн хувилбар"
          >
            <a href={AI_SETUP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4" />
              Setup татах
            </a>
          </Button>
          <Button size="sm" onClick={() => void generateCode()}>
            <Plus className="h-4 w-4" />
            Холболтын код үүсгэх
          </Button>
        </div>
      </div>

      {error && <p className="text-[var(--color-danger)]">{error}</p>}

      {nodes === null && !error ? (
        <Spinner />
      ) : nodes && nodes.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-[var(--color-muted-foreground)]">
            AI сервер бүртгэгдээгүй. "Холболтын код үүсгэх" дарж, суулгасан AI
            дээрээ оруулна уу.
          </CardContent>
        </Card>
      ) : nodes ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Нэр / Hostname</TableHead>
                  <TableHead>Төлөв</TableHead>
                  <TableHead>Хувилбар</TableHead>
                  <TableHead>Telemetry</TableHead>
                  <TableHead>Тохиргоо</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell>
                      <div className="font-medium">{n.name || n.hostname || "—"}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        {n.hostname}
                        {n.gpu ? ` · ${n.gpu}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      {!n.is_active ? (
                        <Badge tone="danger">Цуцалсан</Badge>
                      ) : isOnline(n) ? (
                        <Badge tone="success">Online</Badge>
                      ) : (
                        <Badge tone="neutral">Offline</Badge>
                      )}
                      {!n.enabled && n.is_active && (
                        <Badge tone="neutral">Унтраалттай</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{n.version || "—"}</TableCell>
                    <TableCell className="text-sm text-[var(--color-muted-foreground)]">
                      {telemetrySummary(n.telemetry)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {n.provider} · skip {n.frame_skip}
                    </TableCell>
                    <TableCell>
                      <Dropdown>
                        <DropdownTrigger asChild>
                          <Button variant="ghost" size="sm" aria-label="Үйлдэл">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownTrigger>
                        <DropdownContent align="end">
                          <DropdownItem onSelect={() => setEditing(n)}>
                            Тохиргоо засах
                          </DropdownItem>
                          {n.is_active && (
                            <DropdownItem onSelect={() => void revoke(n)}>
                              Цуцлах
                            </DropdownItem>
                          )}
                        </DropdownContent>
                      </Dropdown>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <PairingCodeModal pairing={pairing} onClose={() => setPairing(null)} />
      <EditNodeModal
        node={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void reload();
        }}
      />
    </div>
  );
}

function PairingCodeModal({
  pairing,
  onClose,
}: {
  pairing: AiNodePairingCode | null;
  onClose: () => void;
}) {
  return (
    <Modal open={pairing !== null} onOpenChange={(o) => !o && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>AI сервер холбох код</ModalTitle>
        </ModalHeader>
        <div className="space-y-4 text-center">
          <div className="inline-flex items-center gap-2 text-[var(--color-muted-foreground)]">
            <Cpu className="h-4 w-4" />
            Суулгасан AI-н тохиргоонд энэ кодыг оруулна уу
          </div>
          <div className="font-mono text-5xl font-bold tracking-[0.3em]">
            {pairing?.code}
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {pairing
              ? `Хүчинтэй: ${new Date(pairing.expires_at).toLocaleString("mn-MN")}`
              : ""}
          </p>
        </div>
        <ModalFooter>
          <Button onClick={onClose}>Хаах</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function EditNodeModal({
  node,
  onClose,
  onSaved,
}: {
  node: AiNodePublic | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [frameSkip, setFrameSkip] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!node) return;
    setName(node.name ?? "");
    setEnabled(node.enabled);
    setProvider(node.provider);
    setFrameSkip(node.frame_skip);
    setError(null);
  }, [node]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!node) return;
    setSaving(true);
    setError(null);
    try {
      await admin.updateAiNode(node.id, {
        name: name.trim() || null,
        enabled,
        provider,
        frame_skip: frameSkip,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Хадгалж чадсангүй");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={node !== null} onOpenChange={(o) => !o && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>AI серверийн тохиргоо</ModalTitle>
        </ModalHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <Field label="Нэр">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Жишээ: Predator-1"
              disabled={saving}
            />
          </Field>
          <Field label="VLM provider">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={saving}
              className={selectClass}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Frame skip" hint="Хэдэн кадр тутамд нэг шинжлэх (0–30)">
            <Input
              type="number"
              min={0}
              max={30}
              value={frameSkip}
              onChange={(e) => setFrameSkip(Number(e.target.value))}
              disabled={saving}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={saving}
              className="h-4 w-4"
            />
            Идэвхтэй (унтраавал AI шинжилгээ зогсоно)
          </label>
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Болих
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
