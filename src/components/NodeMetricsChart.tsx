/**
 * Resource time-series charts for one AI node (docs/19 Phase 1b). Fetches
 * /admin/ai-nodes/{id}/metrics?range= and draws lightweight inline-SVG
 * sparklines (CPU% / GPU% / RAM% / VRAM%) with a range switcher — no charting lib.
 *
 * Points are positioned on the x-axis by their REAL timestamp inside the selected
 * window [now-range, now], and the line is BROKEN across time gaps (offline
 * periods). This stops a node that just came online from looking like it had
 * uninterrupted coverage for the whole range — gaps now read as gaps.
 */
import { useEffect, useState } from "react";

import { admin, ApiError, type NodeMetric } from "@/lib/api";

const RANGES = [
  { key: "1h", label: "1ц" },
  { key: "6h", label: "6ц" },
  { key: "24h", label: "24ц" },
  { key: "7d", label: "7 хон" },
  { key: "30d", label: "30 хон" },
];

const HOUR = 3_600_000;
const DAY = 86_400_000;
const RANGE_MS: Record<string, number> = {
  "1h": HOUR,
  "6h": 6 * HOUR,
  "24h": 24 * HOUR,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
};

type Pt = { t: number; v: number | null };

/**
 * A 0–100 sparkline drawn on a TIME axis. `series` carries each sample's epoch-ms
 * timestamp; points are placed by time within [windowStart, windowStart+windowMs]
 * and the polyline is split into segments wherever there is a null sample or a
 * time gap larger than `gapMs` (so offline stretches are not bridged).
 */
function Sparkline({
  label,
  color,
  series,
  windowStart,
  windowMs,
  gapMs,
  latest,
}: {
  label: string;
  color: string;
  series: Pt[];
  windowStart: number;
  windowMs: number;
  gapMs: number;
  latest: string;
}) {
  const w = 240;
  const h = 40;
  const xOf = (t: number) =>
    Math.max(0, Math.min(1, (t - windowStart) / windowMs)) * w;
  const yOf = (v: number) => h - (Math.max(0, Math.min(100, v)) / 100) * h;

  // Split into continuous segments: break on a null value or a too-large time gap.
  const segments: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  let prevT: number | null = null;
  for (const p of series) {
    const gap = prevT != null && p.t - prevT > gapMs;
    if ((p.v == null || gap) && cur.length) {
      segments.push(cur);
      cur = [];
    }
    if (p.v != null) cur.push({ x: xOf(p.t), y: yOf(p.v) });
    prevT = p.t;
  }
  if (cur.length) segments.push(cur);

  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-[var(--color-muted-foreground)]">{label}</span>
        <span className="font-medium" style={{ color }}>
          {latest}
        </span>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {segments.map((seg, i) => {
          if (seg.length === 1) {
            // A lone sample with no neighbour to connect to — show a dot.
            return (
              <circle key={i} cx={seg[0].x} cy={seg[0].y} r={1.6} fill={color} />
            );
          }
          const line = seg.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
          const area = `${seg[0].x.toFixed(1)},${h} ${line} ${seg[seg.length - 1].x.toFixed(1)},${h}`;
          return (
            <g key={i}>
              <polyline points={area} fill={color} fillOpacity={0.12} stroke="none" />
              <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function NodeMetricsChart({ nodeId }: { nodeId: string }) {
  const [range, setRange] = useState("24h");
  const [data, setData] = useState<NodeMetric[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    admin.nodeMetrics(nodeId, range).then(
      (rows) => !cancelled && setData(rows),
      (e) => !cancelled && setError(e instanceof ApiError ? e.message : "Алдаа"),
    );
    return () => {
      cancelled = true;
    };
  }, [nodeId, range]);

  const ramPct = (m: NodeMetric) =>
    m.ram_used_mb != null && m.ram_total_mb ? (m.ram_used_mb / m.ram_total_mb) * 100 : null;
  const vramPct = (m: NodeMetric) =>
    m.vram_used_mb != null && m.vram_total_mb ? (m.vram_used_mb / m.vram_total_mb) * 100 : null;
  const gb = (mb: number | null | undefined) => (Number(mb) / 1024).toFixed(1);

  // Sort by timestamp so segmentation + "latest" are correct regardless of order.
  const rows = (data ?? [])
    .map((m) => ({ m, t: Date.parse(m.ts) }))
    .filter((r) => !Number.isNaN(r.t))
    .sort((a, b) => a.t - b.t);
  const last = rows.length ? rows[rows.length - 1].m : null;

  // Time window: anchor the x-axis to [now - range, now] so recent-only data
  // clusters at the right edge instead of being stretched across the whole width.
  const windowMs = RANGE_MS[range] ?? DAY;
  const now = Date.now();
  const lastT = rows.length ? rows[rows.length - 1].t : now;
  const windowEnd = Math.max(now, lastT);
  const windowStart = windowEnd - windowMs;

  // Gap threshold = 3× the typical sample cadence (median delta), min 2 minutes,
  // so a few missed heartbeats (node offline) break the line instead of bridging.
  const deltas = rows.slice(1).map((r, i) => r.t - rows[i].t).sort((a, b) => a - b);
  const medianDelta = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 60_000;
  const gapMs = Math.max(medianDelta * 3, 120_000);

  const seriesOf = (pick: (m: NodeMetric) => number | null): Pt[] =>
    rows.map((r) => ({ t: r.t, v: pick(r.m) }));

  return (
    <div className="mt-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-background)] p-3">
      <div className="mb-3 flex flex-wrap gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`rounded px-2 py-0.5 text-xs ${
              range === r.key
                ? "bg-[var(--color-primary)] text-white"
                : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-xs text-[var(--color-danger)]">{error}</p>
      ) : data == null ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">Ачааллаж байна…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Энэ хугацаанд өгөгдөл алга (heartbeat бүрт нэг цэг хадгална).
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Sparkline
            label="CPU"
            color="#3b82f6"
            series={seriesOf((m) => m.cpu_pct)}
            windowStart={windowStart}
            windowMs={windowMs}
            gapMs={gapMs}
            latest={last?.cpu_pct != null ? `${last.cpu_pct.toFixed(0)}%` : "—"}
          />
          <Sparkline
            label="GPU"
            color="#22c55e"
            series={seriesOf((m) => m.gpu_pct)}
            windowStart={windowStart}
            windowMs={windowMs}
            gapMs={gapMs}
            latest={last?.gpu_pct != null ? `${last.gpu_pct}%` : "—"}
          />
          <Sparkline
            label="RAM"
            color="#f97316"
            series={seriesOf(ramPct)}
            windowStart={windowStart}
            windowMs={windowMs}
            gapMs={gapMs}
            latest={last ? `${gb(last.ram_used_mb)}/${gb(last.ram_total_mb)} GB` : "—"}
          />
          <Sparkline
            label="VRAM"
            color="#a855f7"
            series={seriesOf(vramPct)}
            windowStart={windowStart}
            windowMs={windowMs}
            gapMs={gapMs}
            latest={last ? `${gb(last.vram_used_mb)}/${gb(last.vram_total_mb)} GB` : "—"}
          />
        </div>
      )}
    </div>
  );
}
