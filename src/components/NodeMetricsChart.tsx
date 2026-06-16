/**
 * Resource time-series charts for one AI node (docs/19 Phase 1b). Fetches
 * /admin/ai-nodes/{id}/metrics?range= and draws lightweight inline-SVG charts
 * (CPU% / GPU% / RAM% / VRAM%) with a range switcher — no charting lib.
 *
 * Each chart has a TIME x-axis (points placed by real timestamp in [now-range,
 * now]; line breaks across offline gaps; numeric tick labels at the foot),
 * gridlines, and a hover crosshair (guide line + dot + tooltip with the precise
 * time and value). A solid line = WHOLE machine; a dashed line = SENTRY-only
 * (this project's processes), where the backend reports it.
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
function fmtTick(t: number, windowMs: number): string {
  const d = new Date(t);
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (windowMs <= DAY) return hm;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return windowMs <= 7 * DAY ? `${md} ${hm}` : md;
}
function fmtPrecise(t: number, windowMs: number): string {
  const d = new Date(t);
  const hms = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  return windowMs <= DAY ? hms : `${d.getMonth() + 1}/${d.getDate()} ${hms}`;
}

const W = 240;
const H = 64;
const Y_GRID = [0, 25, 50, 75, 100];

/** Split a series into continuous segments, breaking on null values or gaps. */
function segmentize(
  series: Pt[],
  gapMs: number,
  xOf: (t: number) => number,
  yOf: (v: number) => number,
): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  let prevT: number | null = null;
  for (const p of series) {
    const gap = prevT != null && p.t - prevT > gapMs;
    if ((p.v == null || gap) && cur.length) {
      out.push(cur);
      cur = [];
    }
    if (p.v != null) cur.push({ x: xOf(p.t), y: yOf(p.v) });
    prevT = p.t;
  }
  if (cur.length) out.push(cur);
  return out;
}

function nearest(series: Pt[], t: number): Pt | null {
  let best: Pt | null = null;
  for (const p of series) {
    if (p.v == null) continue;
    if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  }
  return best;
}

function Chart({
  label,
  color,
  series,
  series2,
  series2Label = "Sentry",
  windowStart,
  windowMs,
  gapMs,
  ticks,
  latest,
  note,
}: {
  label: string;
  color: string;
  series: Pt[];
  series2?: Pt[];
  series2Label?: string;
  windowStart: number;
  windowMs: number;
  gapMs: number;
  ticks: number[];
  latest: string;
  note?: string;
}) {
  const xOf = (t: number) => Math.max(0, Math.min(1, (t - windowStart) / windowMs)) * W;
  const yOf = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;

  const [hoverT, setHoverT] = useState<number | null>(null);

  const seg1 = segmentize(series, gapMs, xOf, yOf);
  const seg2 = series2 ? segmentize(series2, gapMs, xOf, yOf) : [];

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setHoverT(windowStart + frac * windowMs);
  }

  const hp = hoverT != null ? nearest(series, hoverT) : null;
  const hp2 = hoverT != null && series2 ? nearest(series2, hoverT) : null;
  const hx = hp ? xOf(hp.t) : 0;
  const tipLeftPct = Math.max(2, Math.min(98, (hx / W) * 100));

  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-[var(--color-muted-foreground)]">{label}</span>
        <span className="font-medium" style={{ color }}>
          {latest}
        </span>
      </div>
      <div className="relative" onMouseMove={onMove} onMouseLeave={() => setHoverT(null)}>
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
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
          {ticks.map((t, i) => (
            <line
              key={`v${i}`}
              x1={xOf(t)}
              y1={0}
              x2={xOf(t)}
              y2={H}
              stroke="var(--color-border)"
              strokeWidth={0.5}
              strokeOpacity={0.35}
            />
          ))}
          {/* whole-machine (solid + area) */}
          {seg1.map((seg, i) => {
            const firstPt = seg[0];
            const lastPt = seg[seg.length - 1];
            if (!firstPt || !lastPt) return null; // segmentize never emits empty segments
            if (seg.length === 1) {
              return <circle key={`a${i}`} cx={firstPt.x} cy={firstPt.y} r={1.8} fill={color} />;
            }
            const line = seg.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
            const area = `${firstPt.x.toFixed(1)},${H} ${line} ${lastPt.x.toFixed(1)},${H}`;
            return (
              <g key={`a${i}`}>
                <polyline points={area} fill={color} fillOpacity={0.12} stroke="none" />
                <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} />
              </g>
            );
          })}
          {/* sentry-only (dashed, no area) */}
          {seg2.map((seg, i) => {
            const firstPt = seg[0];
            if (!firstPt) return null; // segmentize never emits empty segments
            return seg.length === 1 ? (
              <circle key={`b${i}`} cx={firstPt.x} cy={firstPt.y} r={1.6} fill={color} fillOpacity={0.7} />
            ) : (
              <polyline
                key={`b${i}`}
                points={seg.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={1.2}
                strokeDasharray="3 2"
                strokeOpacity={0.85}
              />
            );
          })}
          {hp && (
            <>
              <line x1={hx} y1={0} x2={hx} y2={H} stroke={color} strokeOpacity={0.6} strokeWidth={1} />
              <circle cx={hx} cy={yOf(hp.v as number)} r={2.8} fill={color} stroke="white" strokeWidth={1} />
            </>
          )}
        </svg>
        {hp && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-0.5 text-[10px] leading-tight shadow"
            style={{ left: `${tipLeftPct}%` }}
          >
            <div className="text-[var(--color-muted-foreground)]">{fmtPrecise(hp.t, windowMs)}</div>
            <div className="font-medium" style={{ color }}>
              Бүх систем: {hp.label ?? "—"}
            </div>
            {series2 && (
              <div style={{ color }}>{series2Label}: {hp2?.label ?? "—"}</div>
            )}
          </div>
        )}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-[var(--color-muted-foreground)]">
        {ticks.map((t, i) => (
          <span key={i}>{fmtTick(t, windowMs)}</span>
        ))}
      </div>
      {note && (
        <p className="mt-0.5 text-[10px] italic text-[var(--color-muted-foreground)]">{note}</p>
      )}
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
  const sRamPct = (m: NodeMetric) =>
    m.sentry_ram_mb != null && m.ram_total_mb ? (m.sentry_ram_mb / m.ram_total_mb) * 100 : null;
  const sVramPct = (m: NodeMetric) =>
    m.sentry_vram_mb != null && m.vram_total_mb ? (m.sentry_vram_mb / m.vram_total_mb) * 100 : null;
  const gb = (mb: number | null | undefined) => (Number(mb) / 1024).toFixed(1);

  const rows = (data ?? [])
    .map((m) => ({ m, t: Date.parse(m.ts) }))
    .filter((r) => !Number.isNaN(r.t))
    .sort((a, b) => a.t - b.t);
  const lastRow = rows[rows.length - 1];
  const last = lastRow?.m ?? null;

  const windowMs = RANGE_MS[range] ?? DAY;
  const now = Date.now();
  const lastT = lastRow?.t ?? now;
  const windowEnd = Math.max(now, lastT);
  const windowStart = windowEnd - windowMs;

  const deltas: number[] = [];
  let prevT: number | null = null;
  for (const r of rows) {
    if (prevT != null) deltas.push(r.t - prevT);
    prevT = r.t;
  }
  deltas.sort((a, b) => a - b);
  const medianDelta = deltas[Math.floor(deltas.length / 2)] ?? 60_000;
  const gapMs = Math.max(medianDelta * 3, 120_000);

  const seriesOf = (
    pickV: (m: NodeMetric) => number | null,
    fmtLabel: (m: NodeMetric, v: number) => string,
  ): Pt[] =>
    rows.map((r) => {
      const v = pickV(r.m);
      return { t: r.t, v, label: v == null ? null : fmtLabel(r.m, v) };
    });

  const ticks = [0, 1, 2, 3, 4].map((i) => windowStart + (i / 4) * windowMs);
  const hasSentry = rows.some((r) => r.m.sentry_cpu_pct != null || r.m.sentry_ram_mb != null);

  return (
    <div className="mt-3 min-w-0 overflow-x-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-background)] p-3">
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
          {hasSentry ? "── бүх систем · ╌╌ Sentry · " : ""}х.тэнхлэг: цаг хугацаа
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
            series2={seriesOf((m) => m.sentry_cpu_pct, (_m, v) => `${v.toFixed(0)}%`)}
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
            note="Ногоон шугам өсөх = GPU дээр ажиллаж байна (энэ node-д бараг бүгд AI: YOLO + VLM). Process тусын GPU% NVML-д байхгүй; VRAM-ийг доорх графикаас хар."
          />
          <Chart
            label="RAM"
            color="#f97316"
            series={seriesOf(ramPct, (m, v) => `${gb(m.ram_used_mb)}/${gb(m.ram_total_mb)} GB · ${v.toFixed(0)}%`)}
            series2={seriesOf(sRamPct, (m, v) => `${gb(m.sentry_ram_mb)} GB · ${v.toFixed(0)}%`)}
            windowStart={windowStart}
            windowMs={windowMs}
            gapMs={gapMs}
            ticks={ticks}
            latest={last ? `${gb(last.ram_used_mb)}/${gb(last.ram_total_mb)} GB` : "—"}
          />
          <Chart
            label="VRAM (GPU санах ой)"
            color="#a855f7"
            series={seriesOf(vramPct, (m, v) => `${gb(m.vram_used_mb)}/${gb(m.vram_total_mb)} GB · ${v.toFixed(0)}%`)}
            series2={seriesOf(sVramPct, (m, v) => `${gb(m.sentry_vram_mb)} GB · ${v.toFixed(0)}%`)}
            series2Label="VLM (GPU)"
            windowStart={windowStart}
            windowMs={windowMs}
            gapMs={gapMs}
            ticks={ticks}
            latest={last ? `${gb(last.vram_used_mb)}/${gb(last.vram_total_mb)} GB` : "—"}
            note="── бүх төхөөрөмж (суурь ~2 GB = YOLO тасралтгүй). ╌╌ = VLM-ийн GPU VRAM — зөрчил шалгахад ~4 GB рүү өснө."
          />
        </div>
      )}
    </div>
  );
}
