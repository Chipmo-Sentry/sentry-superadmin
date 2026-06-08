/**
 * Resource time-series charts for one AI node (docs/19 Phase 1b). Fetches
 * /admin/ai-nodes/{id}/metrics?range= and draws lightweight inline-SVG charts
 * (CPU% / GPU% / RAM% / VRAM%) with a range switcher — no charting lib.
 *
 * Each chart has: a TIME x-axis (points placed by real timestamp in [now-range,
 * now]; line breaks across offline gaps; numeric time tick labels at the foot),
 * horizontal + vertical gridlines, and a hover crosshair (vertical guide line +
 * dot + tooltip with the precise time and the sample value).
 */
import { type MouseEvent, useEffect, useState } from "react";

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

type Pt = { t: number; v: number | null; label: string | null };

const p2 = (n: number) => String(n).padStart(2, "0");
/** Tick label whose precision matches the window: HH:mm for ≤1 day, else M/D[ HH:mm]. */
function fmtTick(t: number, windowMs: number): string {
  const d = new Date(t);
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (windowMs <= DAY) return hm;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return windowMs <= 7 * DAY ? `${md} ${hm}` : md;
}
/** Precise hover time: HH:mm:ss for ≤1 day, else M/D HH:mm:ss. */
function fmtPrecise(t: number, windowMs: number): string {
  const d = new Date(t);
  const hms = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  return windowMs <= DAY ? hms : `${d.getMonth() + 1}/${d.getDate()} ${hms}`;
}

/** Chart geometry (viewBox units; preserveAspectRatio=none stretches to width). */
const W = 240;
const H = 64;
const Y_GRID = [0, 25, 50, 75, 100]; // percent lines

function Chart({
  label,
  color,
  series,
  windowStart,
  windowMs,
  gapMs,
  ticks,
  latest,
}: {
  label: string;
  color: string;
  series: Pt[];
  windowStart: number;
  windowMs: number;
  gapMs: number;
  ticks: number[];
  latest: string;
}) {
  const xOf = (t: number) => Math.max(0, Math.min(1, (t - windowStart) / windowMs)) * W;
  const yOf = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;

  const [hover, setHover] = useState<{ cx: number; cy: number; pt: Pt } | null>(null);

  // Continuous segments: break on null value or a too-large time gap.
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

  const drawable = series.filter((p) => p.v != null);

  function onMove(e: MouseEvent<HTMLDivElement>) {
    if (!drawable.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const tHover = windowStart + frac * windowMs;
    let best = drawable[0];
    for (const p of drawable) {
      if (Math.abs(p.t - tHover) < Math.abs(best.t - tHover)) best = p;
    }
    setHover({ cx: xOf(best.t), cy: yOf(best.v as number), pt: best });
  }

  const tipLeftPct = hover ? Math.max(2, Math.min(98, (hover.cx / W) * 100)) : 0;

  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-[var(--color-muted-foreground)]">{label}</span>
        <span className="font-medium" style={{ color }}>
          {latest}
        </span>
      </div>
      <div className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* horizontal gridlines (0/25/50/75/100%) */}
          {Y_GRID.map((g) => {
            const y = yOf(g);
            return (
              <line
                key={`h${g}`}
                x1={0}
                y1={y}
                x2={W}
                y2={y}
                stroke="var(--color-border)"
                strokeWidth={g === 0 ? 1 : 0.5}
                strokeOpacity={g === 0 ? 0.8 : 0.45}
              />
            );
          })}
          {/* vertical gridlines at each time tick */}
          {ticks.map((t, i) => {
            const x = xOf(t);
            return (
              <line
                key={`v${i}`}
                x1={x}
                y1={0}
                x2={x}
                y2={H}
                stroke="var(--color-border)"
                strokeWidth={0.5}
                strokeOpacity={0.35}
              />
            );
          })}
          {/* data */}
          {segments.map((seg, i) => {
            if (seg.length === 1) {
              return <circle key={i} cx={seg[0].x} cy={seg[0].y} r={1.8} fill={color} />;
            }
            const line = seg.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
            const area = `${seg[0].x.toFixed(1)},${H} ${line} ${seg[seg.length - 1].x.toFixed(1)},${H}`;
            return (
              <g key={i}>
                <polyline points={area} fill={color} fillOpacity={0.12} stroke="none" />
                <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} />
              </g>
            );
          })}
          {/* hover crosshair */}
          {hover && (
            <>
              <line x1={hover.cx} y1={0} x2={hover.cx} y2={H} stroke={color} strokeOpacity={0.6} strokeWidth={1} />
              <circle cx={hover.cx} cy={hover.cy} r={2.8} fill={color} stroke="white" strokeWidth={1} />
            </>
          )}
        </svg>
        {hover && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-0.5 text-[10px] leading-tight shadow"
            style={{ left: `${tipLeftPct}%` }}
          >
            <div className="text-[var(--color-muted-foreground)]">
              {fmtPrecise(hover.pt.t, windowMs)}
            </div>
            <div className="font-medium" style={{ color }}>
              {label}: {hover.pt.label ?? "—"}
            </div>
          </div>
        )}
      </div>
      {/* per-chart time axis labels */}
      <div className="mt-0.5 flex justify-between text-[10px] text-[var(--color-muted-foreground)]">
        {ticks.map((t, i) => (
          <span key={i}>{fmtTick(t, windowMs)}</span>
        ))}
      </div>
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

  const rows = (data ?? [])
    .map((m) => ({ m, t: Date.parse(m.ts) }))
    .filter((r) => !Number.isNaN(r.t))
    .sort((a, b) => a.t - b.t);
  const last = rows.length ? rows[rows.length - 1].m : null;

  const windowMs = RANGE_MS[range] ?? DAY;
  const now = Date.now();
  const lastT = rows.length ? rows[rows.length - 1].t : now;
  const windowEnd = Math.max(now, lastT);
  const windowStart = windowEnd - windowMs;

  const deltas = rows.slice(1).map((r, i) => r.t - rows[i].t).sort((a, b) => a - b);
  const medianDelta = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 60_000;
  const gapMs = Math.max(medianDelta * 3, 120_000);

  const seriesOf = (
    pickV: (m: NodeMetric) => number | null,
    fmtLabel: (m: NodeMetric, v: number) => string,
  ): Pt[] =>
    rows.map((r) => {
      const v = pickV(r.m);
      return { t: r.t, v, label: v == null ? null : fmtLabel(r.m, v) };
    });

  // Five x-axis tick times evenly across the window (also used as vertical gridlines).
  const ticks = [0, 1, 2, 3, 4].map((i) => windowStart + (i / 4) * windowMs);

  return (
    <div className="mt-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-background)] p-3">
      <div className="mb-3 flex flex-wrap items-center gap-1">
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
        <span className="ml-auto text-[10px] text-[var(--color-muted-foreground)]">
          хөндлөн тэнхлэг: цаг хугацаа
        </span>
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
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <Chart
            label="CPU"
            color="#3b82f6"
            series={seriesOf((m) => m.cpu_pct, (_m, v) => `${v.toFixed(0)}%`)}
            windowStart={windowStart}
            windowMs={windowMs}
            gapMs={gapMs}
            ticks={ticks}
            latest={last?.cpu_pct != null ? `${last.cpu_pct.toFixed(0)}%` : "—"}
          />
          <Chart
            label="GPU"
            color="#22c55e"
            series={seriesOf((m) => m.gpu_pct, (_m, v) => `${v.toFixed(0)}%`)}
            windowStart={windowStart}
            windowMs={windowMs}
            gapMs={gapMs}
            ticks={ticks}
            latest={last?.gpu_pct != null ? `${last.gpu_pct}%` : "—"}
          />
          <Chart
            label="RAM"
            color="#f97316"
            series={seriesOf(ramPct, (m, v) => `${gb(m.ram_used_mb)}/${gb(m.ram_total_mb)} GB · ${v.toFixed(0)}%`)}
            windowStart={windowStart}
            windowMs={windowMs}
            gapMs={gapMs}
            ticks={ticks}
            latest={last ? `${gb(last.ram_used_mb)}/${gb(last.ram_total_mb)} GB` : "—"}
          />
          <Chart
            label="VRAM"
            color="#a855f7"
            series={seriesOf(vramPct, (m, v) => `${gb(m.vram_used_mb)}/${gb(m.vram_total_mb)} GB · ${v.toFixed(0)}%`)}
            windowStart={windowStart}
            windowMs={windowMs}
            gapMs={gapMs}
            ticks={ticks}
            latest={last ? `${gb(last.vram_used_mb)}/${gb(last.vram_total_mb)} GB` : "—"}
          />
        </div>
      )}
    </div>
  );
}
