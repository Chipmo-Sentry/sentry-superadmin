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

interface ComponentUsage {
  name: string;
  cpu_pct: number | null;
  ram_mb: number | null;
}
interface VlmStatus {
  loaded: boolean;
  model: string | null;
  vram_mb: number | null;
  gpu_pct: number | null;
}

function parseComponents(raw: string | null): ComponentUsage[] | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as { components?: unknown };
    return Array.isArray(t.components) ? (t.components as ComponentUsage[]) : null;
  } catch {
    return null;
  }
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

const CARD = "rounded-md px-3 py-2.5";
const ROW = "flex items-center justify-between rounded-md px-3 py-2 text-sm";

/** AI-server resource panel, rethought around WHAT the GPU is doing: YOLO (always
 * on, light) + the VLM (event-driven — its run history proves it uses the GPU even
 * while idle), then the whole-GPU total, then the system processes. */
function ResourceBreakdown({
  telemetry,
  desiredProvider,
}: {
  telemetry: string | null;
  desiredProvider: string;
}) {
  const comps = parseComponents(telemetry);
  const vlm = parseVlm(telemetry);
  const vram = parseVram(telemetry);
  const act = parseVlmActivity(telemetry);
  const prov = parseProviderStatus(telemetry);
  const { fps, cams } = parseFps(telemetry);
  if ((!comps || comps.length === 0) && !vlm && vram.used == null) return null;

  const vlmVram = vlm?.loaded ? (vlm.vram_mb ?? 0) : 0;
  // Per-process VRAM is N/A on WDDM; on this single-GPU box the only CUDA users are
  // sentry-ai (YOLO + torch) and the VLM, so YOLO ≈ device VRAM − the VLM's VRAM.
  const sentryVram = vram.used != null ? Math.max(0, vram.used - vlmVram) : null;
  const yoloRunning = (fps ?? 0) > 0;
  const vlmModel = vlm?.model ?? prov?.effective ?? desiredProvider;
  const secBg = { background: "var(--color-background-secondary)" } as const;
  const muted = "text-[var(--color-muted-foreground)]";

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="text-sm text-[var(--color-foreground)]">AI ачаалал (GPU)</div>

      <div className={CARD} style={secBg}>
        <div className="flex items-center justify-between">
          <span className="text-sm">YOLO — хүн / объект таних (тасралтгүй)</span>
          <span
            className="text-xs"
            style={{ color: yoloRunning ? "var(--color-success)" : "var(--color-muted-foreground)" }}
          >
            {yoloRunning ? "● GPU дээр ажиллаж байна" : "⏸ камер хүлээж байна"}
          </span>
        </div>
        <div className={`mt-1 text-xs ${muted}`}>
          {sentryVram != null ? `~${(sentryVram / 1024).toFixed(1)} GB VRAM` : "GPU дээр"}
          {cams != null ? ` · ${cams} камер` : ""}
          {fps != null ? ` · ${fps.toFixed(1)} FPS` : ""}
          {" · жижиг модель тул GPU util бага нь хэвийн"}
        </div>
      </div>

      <div className={CARD} style={secBg}>
        <div className="flex items-center justify-between">
          <span className="text-sm">VLM — зөрчил шалгах ({vlmModel})</span>
          {vlm?.loaded ? (
            <span className="text-xs" style={{ color: "var(--color-success)" }}>
              ● ОДОО GPU дээр · {((vlm.vram_mb ?? 0) / 1024).toFixed(1)} GB · {vlm.gpu_pct ?? 0}% GPU
            </span>
          ) : prov?.ready ? (
            <span className="text-xs" style={{ color: "var(--color-success)" }}>
              ✓ GPU-д бэлэн
            </span>
          ) : (
            <span className={`text-xs ${muted}`}>хүлээгдэж байна</span>
          )}
        </div>
        <div className={`mt-1 text-xs ${muted}`}>
          {vlm?.loaded ? "" : "зөрчилд л богино ачаалагдана · ажиллах үед ~3.9 GB / 100% GPU"}
          {act ? ` · сүүлд: ${agoLabel(act.last_ago_sec)}` : ""}
          {act && act.count > 0 ? ` · нийт ${act.count} verify` : ""}
          {act && act.last_latency_ms != null ? ` · ${(act.last_latency_ms / 1000).toFixed(1)}с` : ""}
        </div>
      </div>

      {vram.used != null && (
        <div className={CARD} style={secBg}>
          <div className="flex items-center justify-between text-sm">
            <span>GPU нийт (бүх төхөөрөмж)</span>
            <span className={muted}>
              {vram.gpu ?? 0}% · VRAM {(vram.used / 1024).toFixed(1)}/
              {((vram.total ?? 8192) / 1024).toFixed(1)} GB
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: "var(--color-muted)" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (vram.used / (vram.total ?? 8192)) * 100)}%`,
                background: "#a855f7",
              }}
            />
          </div>
        </div>
      )}

      {comps && comps.length > 0 && (
        <>
          <div className={`mt-1 text-sm ${muted}`}>Системийн процессууд (CPU/RAM)</div>
          {comps.map((c) => (
            <div key={c.name} className={ROW} style={secBg}>
              <span>{c.name}</span>
              <span className={muted}>
                CPU {Math.round(c.cpu_pct ?? 0)}% · RAM{" "}
                {((c.ram_mb ?? 0) / 1024).toFixed(c.ram_mb && c.ram_mb >= 1024 ? 1 : 2)} GB
              </span>
            </div>
          ))}
        </>
      )}

      <div className={`text-xs ${muted}`}>
        YOLO тасралтгүй GPU дээр хүн таньдаг (жижиг тул util бага). VLM зөрчил гарахад л GPU дээр
        богино ачаалагддаг — VRAM графикийн ягаан өндөрлөгүүд = VLM ажилласан үе. GPU util (%) бол
        бүх төхөөрөмжийнх; WDDM дээр процесс тусын VRAM-ыг NVML гаргадаггүй тул YOLO-гийнх нь нийт−VLM
        ойролцоо тооцоо.
      </div>
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!node) return;
    setName(node.name ?? "");
    setEnabled(node.enabled);
    setProvider(node.provider);
    setFrameSkip(node.frame_skip);
    setBreachMode(node.breach_mode === "off" ? "off" : "node_push");
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
