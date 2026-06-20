/** Shared helpers to turn an AI node's raw heartbeat telemetry + central-control
 * fields into the per-stage pipeline status the superadmin "Урсгал" page renders.
 *
 * Superadmin only has `admin.listAiNodes()` (no per-camera/cloud-ingest endpoint),
 * so every stage is derived from a single AiNodePublic: the telemetry JSON string
 * (fps, active_cameras, health{ai,ollama,ingest,tunnel}, vlm) plus the computed
 * fields (is_online, cameras[], provider_ready/error, breach_mode_effective). */
import type { AiNodePublic } from "@/lib/types";

/** One camera's stream health as reported inside the node heartbeat. */
export type CameraHealth = NonNullable<AiNodePublic["cameras"]>[number];

export interface NodeTelemetry {
  cpuPct: number | null;
  gpuPct: number | null;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
  fps: number | null;
  activeCameras: number | null;
  health: Record<string, boolean> | null;
  vlmLoaded: boolean | null;
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

const EMPTY: NodeTelemetry = {
  cpuPct: null,
  gpuPct: null,
  vramUsedMb: null,
  vramTotalMb: null,
  fps: null,
  activeCameras: null,
  health: null,
  vlmLoaded: null,
};

export function parseTelemetry(raw: string | null): NodeTelemetry {
  if (!raw) return EMPTY;
  let t: Record<string, unknown>;
  try {
    t = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return EMPTY;
  }
  const health =
    t.health && typeof t.health === "object"
      ? (t.health as Record<string, boolean>)
      : null;
  const vlm =
    t.vlm && typeof t.vlm === "object" ? (t.vlm as { loaded?: unknown }) : null;
  return {
    cpuPct: num(t.cpu_pct),
    gpuPct: num(t.gpu_pct),
    vramUsedMb: num(t.vram_used_mb),
    vramTotalMb: num(t.vram_total_mb),
    fps: num(t.fps_inference),
    activeCameras: num(t.active_cameras),
    health,
    vlmLoaded: vlm && typeof vlm.loaded === "boolean" ? vlm.loaded : null,
  };
}

export type StageState = "ok" | "warn" | "down" | "idle";
export interface StageStatus {
  state: StageState;
  label: string;
}

export const STAGE_KEYS = [
  "camera",
  "ingest",
  "yolo",
  "tracker",
  "vlm",
  "decision",
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];
export type PipelineStages = Record<StageKey, StageStatus>;

export type NodeLiveState = "online" | "offline" | "disabled" | "revoked";

export function nodeLiveState(n: AiNodePublic): NodeLiveState {
  if (!n.is_active) return "revoked";
  if (!n.is_online) return "offline";
  if (!n.enabled) return "disabled";
  return "online";
}

/** Number of cameras the node currently serves (telemetry gauge, falling back to
 * the per-camera health list length). */
export function nodeCameraCount(n: AiNodePublic): number {
  const ac = parseTelemetry(n.telemetry).activeCameras;
  if (ac != null) return ac;
  return n.cameras?.length ?? 0;
}

function fill(state: StageState, label: string): PipelineStages {
  return {
    camera: { state, label },
    ingest: { state, label },
    yolo: { state, label },
    tracker: { state, label },
    vlm: { state, label },
    decision: { state, label },
  };
}

/** Per-stage status for one node, mirroring the customer app's pipeline canvas
 * (Камер → Cloud ingest → YOLO → Tracker+дүрэм → VLM → Шийдвэр). */
export function derivePipeline(n: AiNodePublic): PipelineStages {
  const live = nodeLiveState(n);
  if (live === "revoked") return fill("idle", "цуцалсан");
  if (live === "offline") return fill("down", "офлайн");
  if (live === "disabled") return fill("idle", "унтраалттай");

  const t = parseTelemetry(n.telemetry);
  const h = t.health ?? {};
  const cams = n.cameras ?? [];
  const count = t.activeCameras ?? (cams.length || 0);
  const errored = cams.filter((c) => c.status === "error").length;
  const stalled = cams.filter((c) => c.status === "stalled").length;

  const camera: StageStatus =
    count > 0
      ? errored > 0
        ? { state: "down", label: `${errored}/${count} унтарсан` }
        : stalled > 0
          ? { state: "warn", label: `${stalled}/${count} зогссон` }
          : { state: "ok", label: `${count} камер` }
      : { state: "idle", label: "камер алга" };

  const ingest: StageStatus =
    h.ingest === true
      ? { state: "ok", label: "OK" }
      : h.ingest === false
        ? { state: "down", label: "доголдол" }
        : { state: "idle", label: "—" };

  const yolo: StageStatus =
    t.fps != null && t.fps > 0
      ? { state: "ok", label: `${t.fps.toFixed(1)} fps` }
      : h.ai === false
        ? { state: "down", label: "унтарсан" }
        : { state: "warn", label: "хүлээгдэж" };

  const tracker: StageStatus =
    t.fps != null && t.fps > 0
      ? { state: "ok", label: "ажиллаж" }
      : { state: "idle", label: "хүлээгдэж" };

  const vlm: StageStatus = t.vlmLoaded
    ? { state: "ok", label: "ачаалсан" }
    : n.provider_ready
      ? { state: "ok", label: "бэлэн" }
      : n.provider_error
        ? { state: "down", label: "алдаа" }
        : h.ollama === false
          ? { state: "down", label: "унтарсан" }
          : { state: "warn", label: "хүлээгдэж" };

  const dm = n.breach_mode_effective ?? n.breach_mode;
  const decision: StageStatus =
    dm === "node_push"
      ? { state: "ok", label: "идэвхтэй" }
      : dm === "off"
        ? { state: "idle", label: "унтраалттай" }
        : { state: "warn", label: "хүлээгдэж" };

  return { camera, ingest, yolo, tracker, vlm, decision };
}
