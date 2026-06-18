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

// VLM providers OFFERED in the UI = those actually pulled/runnable on the node's
// Ollama today (verified 2026-06-17: qwen3-vl:4b-instruct + minicpm-v:8b). Default
// first. The backend registry (sentry-ai providers/factory.py) still knows two more
// that are NOT offered here because they can't run on this node:
//   - qwen3-vl-vllm  : Linux-GPU scale path, needs a separate vLLM server (none yet)
//   - qwen2.5-vl-7b  : deprecated (ADR-0026) rollback, model not pulled
// Omitting them stops an operator from picking a provider that would fail to apply.
// Re-add a name here once its model is installed / a vLLM host exists.
const PROVIDERS = ["qwen3-vl-4b", "minicpm-v-2.6"];

// Live-breach topology (central control, ADR-0026) — must match the backend
// AiNodeUpdate.breach_mode literals + sentry-ai runtime_config _BREACH_MODES.
const BREACH_MODES = ["node_push", "off"] as const;
const BREACH_MODE_LABELS: Record<string, string> = {
  node_push: "Сэрэмжлүүлэг идэвхтэй (node-push)",
  off: "Унтраалттай (зөвхөн хяналт)",
};

/** Latest published AI server installer (GitHub Releases). `latest/download`
 * always resolves to the newest release asset, so this never needs bumping. */
const AI_SETUP_DOWNLOAD_URL =
  "https://github.com/Chipmo-Sentry/sentry-ai/releases/latest/download/ChipmoSentryAi-Setup.exe";

const gb = (mb: unknown): string => (Number(mb) / 1024).toFixed(1);

/** One compact labeled metric chip (e.g. "GPU 16%"). */
function Pill({ label, value }: { label?: string; value: string }) {
  return (
    <span
      className="inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 text-xs"
      style={{ background: "var(--color-background-secondary)" }}
    >
      {label && <span className="text-[10px] uppercase opacity-55">{label}</span>}
      <span className="font-medium">{value}</span>
    </span>
  );
}

/** Whole-machine telemetry as scannable chips instead of a run-on text blob. */
function TelemetryPills({ raw }: { raw: string | null }) {
  const muted = "text-[var(--color-muted-foreground)]";
  if (!raw) return <span className={muted}>—</span>;
  let t: Record<string, unknown>;
  try {
    t = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return <span className={muted}>—</span>;
  }
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const cpu = num(t.cpu_pct);
  const gpu = num(t.gpu_pct);
  const temp = num(t.gpu_temp_c);
  const ramU = num(t.ram_used_mb);
  const ramT = num(t.ram_total_mb);
  const vramU = num(t.vram_used_mb);
  const vramT = num(t.vram_total_mb);
  const fps = num(t.fps_inference);
  const cams = num(t.active_cameras);
  return (
    <div className="flex flex-wrap gap-1.5">
      {cpu != null && <Pill label="CPU" value={`${cpu.toFixed(0)}%`} />}
      {gpu != null && <Pill label="GPU" value={`${gpu}%`} />}
      {ramU != null && ramT != null && <Pill label="RAM" value={`${gb(ramU)}/${gb(ramT)} GB`} />}
      {vramU != null && vramT != null && (
        <Pill label="VRAM" value={`${gb(vramU)}/${gb(vramT)} GB`} />
      )}
      {temp != null && <Pill value={`${temp}°C`} />}
      {fps != null && <Pill label="FPS" value={fps.toFixed(1)} />}
      {cams != null && <Pill value={`${cams} камер`} />}
    </div>
  );
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
  const amber = { color: "var(--color-warning, #d97706)" };
  // No heartbeat with central-control feedback yet (old node / just paired).
  if (status === null || status.effective === null) {
    return (
      <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
        ⏳ серверээс хариу хүлээж байна…
      </div>
    );
  }
  // The node hasn't caught up to the dropdown pick yet — rolling out. Any error
  // here is about the PREVIOUS provider, so don't show it; show in-progress.
  if (status.effective !== desired) {
    return (
      <div className="mt-0.5 text-xs" style={amber}>
        ⏳ хэрэгжүүлж байна… (сервер дээр одоо: {status.effective})
      </div>
    );
  }
  // effective === desired → the error/ready is about the CURRENT pick.
  if (status.error) {
    return (
      <div className="mt-0.5 text-xs" style={{ color: "var(--color-danger)" }} title={status.error}>
        ⚠ {status.error}
      </div>
    );
  }
  if (status.ready) {
    return (
      <div className="mt-0.5 text-xs" style={{ color: "var(--color-success)" }}>
        ✓ серверт идэвхтэй
      </div>
    );
  }
  return (
    <div className="mt-0.5 text-xs" style={amber}>
      ⏳ шалгаж байна…
    </div>
  );
}

/** Compares the DESIRED breach_mode (dropdown) to what the node reported it
 * actually applied, so the operator sees the server really took the change. */
function BreachModeSyncBadge({
  desired,
  effective,
}: {
  desired: string;
  effective: string | null;
}) {
  if (effective === null) {
    return (
      <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
        ⏳ серверээс хариу хүлээж байна…
      </div>
    );
  }
  if (effective !== desired) {
    return (
      <div className="mt-0.5 text-xs" style={{ color: "var(--color-warning, #d97706)" }}>
        ⏳ хэрэгжүүлж байна… (сервер дээр: {BREACH_MODE_LABELS[effective] ?? effective})
      </div>
    );
  }
  return (
    <div className="mt-0.5 text-xs" style={{ color: "var(--color-success)" }}>
      ✓ серверт идэвхтэй
    </div>
  );
}

interface VlmStatus {
  loaded: boolean;
  model: string | null;
  vram_mb: number | null;
  gpu_pct: number | null;
}

function parseVlm(raw: string | null): VlmStatus | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as { vlm?: unknown };
    return t.vlm && typeof t.vlm === "object" ? (t.vlm as VlmStatus) : null;
  } catch {
    return null;
  }
}
function parseVram(raw: string | null): { used: number | null; total: number | null; gpu: number | null } {
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  if (!raw) return { used: null, total: null, gpu: null };
  try {
    const t = JSON.parse(raw) as { vram_used_mb?: unknown; vram_total_mb?: unknown; gpu_pct?: unknown };
    return { used: n(t.vram_used_mb), total: n(t.vram_total_mb), gpu: n(t.gpu_pct) };
  } catch {
    return { used: null, total: null, gpu: null };
  }
}

interface VlmActivity {
  count: number;
  last_ago_sec: number | null;
  last_latency_ms: number | null;
}
function parseVlmActivity(raw: string | null): VlmActivity | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as { vlm_activity?: unknown };
    return t.vlm_activity && typeof t.vlm_activity === "object"
      ? (t.vlm_activity as VlmActivity)
      : null;
  } catch {
    return null;
  }
}
function parseFps(raw: string | null): { fps: number | null; cams: number | null } {
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  if (!raw) return { fps: null, cams: null };
  try {
    const t = JSON.parse(raw) as { fps_inference?: unknown; active_cameras?: unknown };
    return { fps: n(t.fps_inference), cams: n(t.active_cameras) };
  } catch {
    return { fps: null, cams: null };
  }
}
function agoLabel(sec: number | null): string {
  if (sec == null) return "хараахан ажиллаагүй";
  if (sec < 60) return `${sec} сек өмнө`;
  if (sec < 3600) return `${Math.round(sec / 60)} мин өмнө`;
  if (sec < 86400) return `${Math.round(sec / 3600)} цаг өмнө`;
  return `${Math.round(sec / 86400)} өдөр өмнө`;
}

function parseSys(raw: string | null): { cpu: number | null; ramU: number | null; ramT: number | null } {
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  if (!raw) return { cpu: null, ramU: null, ramT: null };
  try {
    const t = JSON.parse(raw) as { cpu_pct?: unknown; ram_used_mb?: unknown; ram_total_mb?: unknown };
    return { cpu: n(t.cpu_pct), ramU: n(t.ram_used_mb), ramT: n(t.ram_total_mb) };
  } catch {
    return { cpu: null, ramU: null, ramT: null };
  }
}
function parseYolo(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as { yolo_model?: unknown };
    return typeof t.yolo_model === "string" ? t.yolo_model : null;
  } catch {
    return null;
  }
}

/** One KPI stat card: muted label, big value, optional sub + VRAM-style bar. */
function Kpi({
  label,
  value,
  sub,
  accent,
  bar,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  bar?: number | null;
}) {
  return (
    <div className="rounded-md p-3" style={{ background: "var(--color-background-secondary)" }}>
      <div className="truncate text-xs text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-0.5 text-xl font-medium" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs text-[var(--color-muted-foreground)]">{sub}</div>}
      {bar != null && (
        <div
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: "var(--color-muted)" }}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, bar)}%`, background: "#a855f7" }}
          />
        </div>
      )}
    </div>
  );
}

/** Compact real-time KPI strip — the few numbers that matter at a glance:
 * GPU, the VLM (GPU-ready + live/last-run), YOLO (cameras/FPS), CPU, RAM. */
function ResourceBreakdown({
  telemetry,
  desiredProvider,
}: {
  telemetry: string | null;
  desiredProvider: string;
}) {
  const vlm = parseVlm(telemetry);
  const vram = parseVram(telemetry);
  const act = parseVlmActivity(telemetry);
  const prov = parseProviderStatus(telemetry);
  const { fps, cams } = parseFps(telemetry);
  const sys = parseSys(telemetry);
  const yoloModel = parseYolo(telemetry);
  if (vram.used == null && vlm == null && fps == null && sys.cpu == null) return null;

  const green = "var(--color-success)";
  const yoloRunning = (fps ?? 0) > 0;
  const vlmModel = vlm?.model ?? prov?.effective ?? desiredProvider;
  const g = (mb: number) => (mb / 1024).toFixed(1);

  return (
    <div
      className="mb-4 grid gap-2"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
    >
      <Kpi
        label="GPU ачаалал (util)"
        value={`${vram.gpu ?? 0}%`}
        sub={
          vram.used != null
            ? `VRAM ${g(vram.used)}/${g(vram.total ?? 8192)} GB · ${Math.round((vram.used / (vram.total ?? 8192)) * 100)}%`
            : undefined
        }
        bar={vram.used != null ? (vram.used / (vram.total ?? 8192)) * 100 : null}
      />
      <Kpi
        label={`VLM · ${vlmModel}`}
        value={vlm?.loaded ? `${vlm.gpu_pct ?? 0}% GPU` : prov?.ready ? "GPU-д бэлэн" : "—"}
        accent={vlm?.loaded || prov?.ready ? green : undefined}
        sub={
          vlm?.loaded
            ? `● одоо · ${g(vlm.vram_mb ?? 0)} GB`
            : act
              ? `сүүлд ${agoLabel(act.last_ago_sec)} · ${act.count} verify`
              : "зөрчилд ачаалагдана"
        }
      />
      <Kpi
        label="YOLO модель · хүн таних"
        value={yoloModel ?? "—"}
        accent={yoloRunning ? green : undefined}
        sub={[
          cams != null ? `${cams} камер` : null,
          fps != null ? `${fps.toFixed(1)} FPS` : null,
          yoloRunning ? "● ажиллаж байна" : "хүлээж байна",
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <Kpi label="CPU" value={sys.cpu != null ? `${Math.round(sys.cpu)}%` : "—"} />
      <Kpi
        label="RAM"
        value={sys.ramU != null ? `${g(sys.ramU)} GB` : "—"}
        sub={sys.ramT != null ? `/ ${g(sys.ramT)} GB` : undefined}
      />
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

  // Poll so provider apply-status (⏳→✓) + telemetry update live without a manual
  // reload — the node reports a fresh effective provider/readiness each heartbeat.
  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 8000);
    return () => clearInterval(id);
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
                      <TelemetryPills raw={n.telemetry} />
                      <div className="mt-1.5">
                        <HealthDots health={parseHealth(n.telemetry)} />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>
                        {n.provider} · skip {n.frame_skip}
                      </div>
                      <ProviderSyncBadge
                        desired={n.provider}
                        status={parseProviderStatus(n.telemetry)}
                      />
                      <div className="mt-2 border-t border-[var(--color-border)] pt-1">
                        {BREACH_MODE_LABELS[n.breach_mode] ?? n.breach_mode}
                      </div>
                      <BreachModeSyncBadge
                        desired={n.breach_mode}
                        effective={n.breach_mode_effective}
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
                        <ResourceBreakdown telemetry={n.telemetry} desiredProvider={n.provider} />
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

/** One labeled numeric setting (label + hint + number input) for the node config
 * dialog. Mirrors the Frame-skip Field but reusable across the YOLO/scan knobs. */
function NumSetting({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      />
    </Field>
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
  const [breachMode, setBreachMode] = useState<(typeof BREACH_MODES)[number]>("node_push");
  // Per-node YOLO + scan/VLM tuning (the node hot-applies these without a restart).
  const [personConf, setPersonConf] = useState(0.35);
  const [itemConf, setItemConf] = useState(0.4);
  const [itemEveryN, setItemEveryN] = useState(5);
  const [scanIntervalSec, setScanIntervalSec] = useState(3);
  const [framesPerClip, setFramesPerClip] = useState(1);
  const [frameMaxDim, setFrameMaxDim] = useState(320);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!node) return;
    setName(node.name ?? "");
    setEnabled(node.enabled);
    setProvider(node.provider);
    setFrameSkip(node.frame_skip);
    setBreachMode(node.breach_mode === "off" ? "off" : "node_push");
    setPersonConf(node.person_conf);
    setItemConf(node.item_conf);
    setItemEveryN(node.item_every_n);
    setScanIntervalSec(node.scan_interval_sec);
    setFramesPerClip(node.frames_per_clip);
    setFrameMaxDim(node.frame_max_dim);
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
        breach_mode: breachMode,
        person_conf: personConf,
        item_conf: itemConf,
        item_every_n: itemEveryN,
        scan_interval_sec: scanIntervalSec,
        frames_per_clip: framesPerClip,
        frame_max_dim: frameMaxDim,
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
          <Field
            label="Сэрэмжлүүлгийн горим"
            hint="node_push: AI өөрөө зөрчил илрүүлж, бичлэг огтлоод сэрэмжлүүлэг үүсгэнэ. off: хяналт/overlay ажиллана, сэрэмжлүүлэг үүсгэхгүй."
          >
            <Select
              value={breachMode}
              onChange={(e) => setBreachMode(e.target.value as (typeof BREACH_MODES)[number])}
              disabled={saving}
            >
              {BREACH_MODES.map((m) => (
                <option key={m} value={m}>
                  {BREACH_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          {/* YOLO detection tuning — the node hot-applies these live (no restart). */}
          <div className="space-y-3 rounded-md border border-[var(--color-border)] p-3">
            <div className="text-sm font-medium">YOLO илрүүлэлт</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumSetting
                label="Frame skip"
                hint="Хэдэн кадр тутамд 1 шинжлэх (1–30). Бага = илүү FPS, өндөр ачаалал."
                value={frameSkip}
                onChange={setFrameSkip}
                min={1}
                max={30}
                step={1}
                disabled={saving}
              />
              <NumSetting
                label="Бараа шалгах давтамж"
                hint="Хэдэн шинжилгээ тутамд COCO бараа илрүүлэх (1–30)"
                value={itemEveryN}
                onChange={setItemEveryN}
                min={1}
                max={30}
                step={1}
                disabled={saving}
              />
              <NumSetting
                label="Хүн илрүүлэх босго"
                hint="YOLO хүний confidence (0.05–0.95). Бага = илүү мэдрэмжтэй."
                value={personConf}
                onChange={setPersonConf}
                min={0.05}
                max={0.95}
                step={0.05}
                disabled={saving}
              />
              <NumSetting
                label="Бараа илрүүлэх босго"
                hint="COCO барааны confidence (0.05–0.95)"
                value={itemConf}
                onChange={setItemConf}
                min={0.05}
                max={0.95}
                step={0.05}
                disabled={saving}
              />
            </div>
          </div>

          {/* Scan / VLM tuning — applied per breach on the node. */}
          <div className="space-y-3 rounded-md border border-[var(--color-border)] p-3">
            <div className="text-sm font-medium">Шинжилгээ / VLM</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumSetting
                label="Шинжих давтамж (сек)"
                hint="Хамгийн сэжигтэй хүнийг VLM-д хэдэн сек тутам өгөх (0.5–60)"
                value={scanIntervalSec}
                onChange={setScanIntervalSec}
                min={0.5}
                max={60}
                step={0.5}
                disabled={saving}
              />
              <NumSetting
                label="VLM-д өгөх кадр"
                hint="Клипээс VLM-д өгөх кадрын тоо (1–8). Их = илүү нарийвчлал, удаан."
                value={framesPerClip}
                onChange={setFramesPerClip}
                min={1}
                max={8}
                step={1}
                disabled={saving}
              />
              <NumSetting
                label="VLM зургийн хэмжээ (px)"
                hint="VLM-д өгөх кадрын дээд тал (160–1280)"
                value={frameMaxDim}
                onChange={setFrameMaxDim}
                min={160}
                max={1280}
                step={32}
                disabled={saving}
              />
            </div>
          </div>
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
