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
import { Cpu, Download, LineChart, MoreHorizontal, Plus } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { NodeMetricsChart } from "@/components/NodeMetricsChart";

import { admin } from "@/lib/api";
import type { AiNodePairingCode, AiNodePublic } from "@/lib/types";

// VLM providers the node can hot-apply (must match sentry-ai providers/factory.py
// _REGISTRY keys). Default first. qwen2.5-vl-7b is deprecated, kept for rollback.
const PROVIDERS = ["qwen3-vl-4b", "minicpm-v-2.6", "qwen3-vl-vllm", "qwen2.5-vl-7b"];

/** Latest published AI server installer (GitHub Releases). `latest/download`
 * always resolves to the newest release asset, so this never needs bumping. */
const AI_SETUP_DOWNLOAD_URL =
  "https://github.com/Chipmo-Sentry/sentry-ai/releases/latest/download/ChipmoSentryAi-Setup.exe";

const gb = (mb: unknown): string => (Number(mb) / 1024).toFixed(1);

function telemetrySummary(raw: string | null): string {
  if (!raw) return "—";
  try {
    const t = JSON.parse(raw) as Record<string, unknown>;
    const parts: string[] = [];
    // Resource load (docs/19): CPU / RAM / GPU / VRAM / temp, then FPS + cameras.
    if (t.cpu_pct != null) parts.push(`CPU ${Number(t.cpu_pct).toFixed(0)}%`);
    if (t.ram_used_mb != null && t.ram_total_mb != null)
      parts.push(`RAM ${gb(t.ram_used_mb)}/${gb(t.ram_total_mb)} GB`);
    if (t.gpu_pct != null) parts.push(`GPU ${Number(t.gpu_pct)}%`);
    if (t.vram_used_mb != null && t.vram_total_mb != null)
      parts.push(`VRAM ${gb(t.vram_used_mb)}/${gb(t.vram_total_mb)} GB`);
    else if (t.vram_mb != null) parts.push(`${t.vram_mb} MB VRAM`);
    if (t.gpu_temp_c != null) parts.push(`${Number(t.gpu_temp_c)}°C`);
    if (t.fps_inference != null) parts.push(`${Number(t.fps_inference).toFixed(1)} FPS`);
    if (t.active_cameras != null) parts.push(`${t.active_cameras} камер`);
    return parts.length ? parts.join(" · ") : "—";
  } catch {
    return "—";
  }
}

/** Just THIS project's (Sentry-AI process tree) resource footprint, isolated from
 * the whole machine. Per-process GPU *utilization* isn't exposed by NVML, so only
 * CPU / RAM / VRAM are available — GPU memory (VRAM) is Sentry's GPU footprint. */
function sentryTelemetrySummary(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Record<string, unknown>;
    const parts: string[] = [];
    if (t.sentry_cpu_pct != null) parts.push(`CPU ${Number(t.sentry_cpu_pct).toFixed(0)}%`);
    if (t.sentry_ram_mb != null) parts.push(`RAM ${gb(t.sentry_ram_mb)} GB`);
    if (t.sentry_vram_mb != null) parts.push(`VRAM ${gb(t.sentry_vram_mb)} GB`);
    return parts.length ? parts.join(" · ") : null;
  } catch {
    return null;
  }
}

/** Per-dependency health the node probes locally (ollama/ingest/ai/tunnel). */
function parseHealth(raw: string | null): Record<string, boolean> | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as { health?: unknown };
    return t.health && typeof t.health === "object"
      ? (t.health as Record<string, boolean>)
      : null;
  } catch {
    return null;
  }
}

interface ProviderStatus {
  effective: string | null;
  ready: boolean | null;
  error: string | null;
}

/** Effective VLM provider + readiness the node reported in its last heartbeat
 * (central-control feedback). null when the node hasn't reported it yet. */
function parseProviderStatus(raw: string | null): ProviderStatus | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as {
      provider_effective?: unknown;
      provider_ready?: unknown;
      provider_error?: unknown;
    };
    if (
      !("provider_effective" in t) &&
      !("provider_ready" in t) &&
      !("provider_error" in t)
    ) {
      return null; // old node version — no central-control feedback
    }
    return {
      effective: typeof t.provider_effective === "string" ? t.provider_effective : null,
      ready: typeof t.provider_ready === "boolean" ? t.provider_ready : null,
      error: typeof t.provider_error === "string" ? t.provider_error : null,
    };
  } catch {
    return null;
  }
}

/** Compares the DESIRED provider (n.provider, set by the dropdown) to what the
 * node reported it's actually running, so the operator can see the server really
 * applied the change — and any error (e.g. model not pulled). */
function ProviderSyncBadge({ desired, status }: { desired: string; status: ProviderStatus | null }) {
  if (status?.error) {
    return (
      <div className="mt-0.5 text-xs" style={{ color: "var(--color-danger)" }} title={status.error}>
        ⚠ {status.error}
      </div>
    );
  }
  if (status === null || status.effective === null) {
    return (
      <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
        ⏳ серверээс хариу хүлээж байна…
      </div>
    );
  }
  if (status.effective === desired && status.ready) {
    return (
      <div className="mt-0.5 text-xs" style={{ color: "var(--color-success)" }}>
        ✓ серверт идэвхтэй
      </div>
    );
  }
  // Reported, but not yet matching the desired pick → still rolling out.
  return (
    <div className="mt-0.5 text-xs" style={{ color: "var(--color-warning, #d97706)" }}>
      ⏳ хэрэгжүүлж байна… (одоо: {status.effective})
    </div>
  );
}

const HEALTH_ORDER = ["ai", "ollama", "ingest", "tunnel"];
const HEALTH_LABELS: Record<string, string> = {
  ai: "AI",
  ollama: "Ollama",
  ingest: "Ingest",
  tunnel: "Tunnel",
};

function HealthDots({ health }: { health: Record<string, boolean> | null }) {
  if (!health) return null;
  const keys = HEALTH_ORDER.filter((k) => k in health).concat(
    Object.keys(health).filter((k) => !HEALTH_ORDER.includes(k)),
  );
  if (keys.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {keys.map((k) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 text-xs"
          title={health[k] ? "OK" : "DOWN"}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              backgroundColor: health[k]
                ? "var(--color-success)"
                : "var(--color-danger)",
            }}
          />
          {HEALTH_LABELS[k] ?? k}
        </span>
      ))}
    </div>
  );
}

export function AiNodesPage() {
  const [nodes, setNodes] = useState<AiNodePublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<AiNodePairingCode | null>(null);
  const [editing, setEditing] = useState<AiNodePublic | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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
                  <Fragment key={n.id}>
                  <TableRow>
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
                      ) : n.is_online ? (
                        <Badge tone="success">Online</Badge>
                      ) : (
                        <Badge tone="neutral">Offline</Badge>
                      )}
                      {!n.enabled && n.is_active && (
                        <Badge tone="neutral">Унтраалттай</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{n.version || "—"}</TableCell>
                    <TableCell className="max-w-md whitespace-normal break-words text-sm">
                      <div className="text-[var(--color-muted-foreground)]">
                        <span className="text-[10px] uppercase opacity-60">Бүх систем </span>
                        {telemetrySummary(n.telemetry)}
                      </div>
                      {sentryTelemetrySummary(n.telemetry) && (
                        <div className="text-[var(--color-foreground)]">
                          <span className="text-[10px] uppercase opacity-60">Sentry </span>
                          {sentryTelemetrySummary(n.telemetry)}
                        </div>
                      )}
                      <HealthDots health={parseHealth(n.telemetry)} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>
                        {n.provider} · skip {n.frame_skip}
                      </div>
                      <ProviderSyncBadge
                        desired={n.provider}
                        status={parseProviderStatus(n.telemetry)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Метрик"
                          onClick={() => setExpanded(expanded === n.id ? null : n.id)}
                        >
                          <LineChart className="h-4 w-4" />
                        </Button>
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
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded === n.id && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <NodeMetricsChart nodeId={n.id} />
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
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
            <Select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={saving}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
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
