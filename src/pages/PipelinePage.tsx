import { Badge, Card, CardContent, Spinner } from "@chipmo-sentry/ui-kit";
import {
  AlertTriangle,
  Bell,
  Brain,
  Cloud,
  type LucideIcon,
  Route,
  ScanEye,
  Video,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";

import { admin } from "@/lib/api";
import {
  derivePipeline,
  nodeCameraCount,
  nodeLiveState,
  parseTelemetry,
  type CameraHealth,
  type StageKey,
  type StageState,
  type StageStatus,
} from "@/lib/nodeTelemetry";
import type { AiNodePublic } from "@/lib/types";

const SUCCESS = "var(--color-success)";
const WARNING = "var(--color-warning)";
const DANGER = "var(--color-danger)";
const MUTED = "var(--color-muted-foreground)";

const STAGE_COLOR: Record<StageState, string> = {
  ok: SUCCESS,
  warn: WARNING,
  down: DANGER,
  idle: MUTED,
};

const STAGES: { key: StageKey; label: string; icon: LucideIcon }[] = [
  { key: "camera", label: "Камер", icon: Video },
  { key: "ingest", label: "Cloud ingest", icon: Cloud },
  { key: "yolo", label: "YOLO", icon: ScanEye },
  { key: "tracker", label: "Tracker + дүрэм", icon: Route },
  { key: "vlm", label: "VLM", icon: Brain },
  { key: "decision", label: "Шийдвэр", icon: Bell },
];

/** One colored pipeline-stage cell: a status dot + short label, tinted by state. */
function StageCell({ s }: { s: StageStatus }) {
  const color = STAGE_COLOR[s.state];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs"
      style={{ color }}
    >
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
      />
      {s.label}
    </span>
  );
}

function NodeStateBadge({ n }: { n: AiNodePublic }) {
  const live = nodeLiveState(n);
  if (live === "revoked") return <Badge tone="danger">Цуцалсан</Badge>;
  if (live === "offline") return <Badge tone="neutral">Офлайн</Badge>;
  if (live === "disabled") return <Badge tone="neutral">Унтраалттай</Badge>;
  return <Badge tone="success">Online</Badge>;
}

const CAM_STATUS: Record<CameraHealth["status"], { color: string; label: string }> = {
  ok: { color: SUCCESS, label: "OK" },
  stalled: { color: WARNING, label: "зогссон" },
  error: { color: DANGER, label: "унтарсан" },
};

/** One KPI chip in the summary strip. */
function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
      <div
        className="mt-0.5 text-xl font-semibold"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

/** Superadmin pipeline ("Урсгал") — the customer app's per-camera canvas, recast
 * as a fleet-wide TABLE: one row per AI node with a color-coded status for each
 * pipeline stage, plus a per-camera breakdown. Built entirely from
 * admin.listAiNodes() telemetry, polled every 8s. */
export function PipelinePage() {
  const [nodes, setNodes] = useState<AiNodePublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setNodes(await admin.listAiNodes());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
    }
  }

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 8000);
    return () => clearInterval(id);
  }, []);

  if (error && !nodes)
    return <p className="p-8 text-[var(--color-danger)]">{error}</p>;
  if (!nodes)
    return (
      <div className="p-8">
        <Spinner />
      </div>
    );

  const onlineCount = nodes.filter((n) => n.is_online).length;
  const offline = nodes.filter((n) => n.is_active && !n.is_online);
  const totalCams = nodes.reduce((s, n) => s + nodeCameraCount(n), 0);
  const totalFps = nodes.reduce(
    (s, n) => s + (parseTelemetry(n.telemetry).fps ?? 0),
    0,
  );
  const camRows = nodes.flatMap((n) =>
    (n.cameras ?? []).map((cam) => ({ node: n, cam })),
  );

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center gap-2">
        <Workflow className="h-6 w-6 text-[var(--color-primary)]" />
        <h1 className="text-2xl font-semibold">Урсгал</h1>
      </div>
      <p className="-mt-3 text-sm text-[var(--color-muted-foreground)]">
        AI сервер бүрийн илрүүлэлтийн урсгал (Камер → Cloud ingest → YOLO →
        Tracker → VLM → Шийдвэр) шатлал бүрээр өнгөөр. ~8 секунд тутам шинэчилнэ.
      </p>

      {offline.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-[var(--color-foreground)]">
            {offline.map((n) => n.name || n.hostname || "—").join(", ")} офлайн —{" "}
            {offline.reduce((s, n) => s + nodeCameraCount(n), 0)} камер харанхуй.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      {/* Fleet summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="AI сервер" value={String(nodes.length)} />
        <Kpi
          label="Онлайн"
          value={`${onlineCount}/${nodes.length}`}
          accent={onlineCount === nodes.length ? SUCCESS : WARNING}
        />
        <Kpi label="Идэвхтэй камер" value={String(totalCams)} />
        <Kpi label="Нийт FPS" value={totalFps.toFixed(1)} />
      </div>

      {/* Per-node stage matrix */}
      {nodes.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-[var(--color-muted-foreground)]">
            AI сервер бүртгэгдээгүй байна.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted)] text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">AI сервер</th>
                <th className="px-3 py-2 text-left font-medium">Төлөв</th>
                {STAGES.map((s) => (
                  <th key={s.key} className="px-3 py-2 text-left font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <s.icon className="h-3.5 w-3.5" />
                      {s.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => {
                const stages = derivePipeline(n);
                const dim = !n.is_online || !n.is_active || !n.enabled;
                return (
                  <tr
                    key={n.id}
                    className={`border-t border-[var(--color-border)] ${dim ? "opacity-60" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium">
                        {n.name || n.hostname || "—"}
                      </div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        {n.hostname}
                        {n.gpu ? ` · ${n.gpu}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <NodeStateBadge n={n} />
                    </td>
                    {STAGES.map((s) => (
                      <td key={s.key} className="px-3 py-2.5">
                        <StageCell s={stages[s.key]} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-camera breakdown */}
      {camRows.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold">Камер бүрээр — задаргаа</h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted)] text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Камер (path)</th>
                  <th className="px-3 py-2 text-left font-medium">AI сервер</th>
                  <th className="px-3 py-2 text-left font-medium">Статус</th>
                  <th className="px-3 py-2 text-right font-medium">FPS</th>
                </tr>
              </thead>
              <tbody>
                {camRows.map(({ node, cam }) => {
                  const st = CAM_STATUS[cam.status];
                  return (
                    <tr
                      key={`${node.id}:${cam.camera_id}`}
                      className="border-t border-[var(--color-border)]"
                    >
                      <td className="px-3 py-2.5 font-mono text-xs">
                        {cam.camera_id}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--color-muted-foreground)]">
                        {node.name || node.hostname || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-flex items-center gap-1.5 text-xs"
                          style={{ color: st.color }}
                        >
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: st.color }}
                          />
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">
                        {cam.fps != null ? cam.fps.toFixed(1) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
