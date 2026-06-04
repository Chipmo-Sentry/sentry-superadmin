/**
 * Resource time-series charts for one AI node (docs/19 Phase 1b). Fetches
 * /admin/ai-nodes/{id}/metrics?range= and draws lightweight inline-SVG
 * sparklines (CPU% / GPU% / RAM%) with a range switcher — no charting lib.
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

/** A 0–100 sparkline: polyline + filled area, with the latest value labelled. */
function Sparkline({
  label,
  color,
  points,
  latest,
}: {
  label: string;
  color: string;
  points: (number | null)[];
  latest: string;
}) {
  const w = 240;
  const h = 40;
  const vals = points.map((p) => (p == null ? 0 : Math.max(0, Math.min(100, p))));
  const n = vals.length;
  const coords = vals.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * w;
    const y = h - (v / 100) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.join(" ");
  const area = n ? `0,${h} ${line} ${w},${h}` : "";
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-[var(--color-muted-foreground)]">{label}</span>
        <span className="font-medium" style={{ color }}>
          {latest}
        </span>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {n > 0 && (
          <>
            <polyline points={area} fill={color} fillOpacity={0.12} stroke="none" />
            <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} />
          </>
        )}
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

  const last = data && data.length ? data[data.length - 1] : null;
  const ramPct = (m: NodeMetric) =>
    m.ram_used_mb != null && m.ram_total_mb ? (m.ram_used_mb / m.ram_total_mb) * 100 : null;
  const vramPct = (m: NodeMetric) =>
    m.vram_used_mb != null && m.vram_total_mb ? (m.vram_used_mb / m.vram_total_mb) * 100 : null;
  const gb = (mb: number | null | undefined) => (Number(mb) / 1024).toFixed(1);

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
      ) : data.length === 0 ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Энэ хугацаанд өгөгдөл алга (heartbeat бүрт нэг цэг хадгална).
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Sparkline
            label="CPU"
            color="#3b82f6"
            points={data.map((m) => m.cpu_pct)}
            latest={last?.cpu_pct != null ? `${last.cpu_pct.toFixed(0)}%` : "—"}
          />
          <Sparkline
            label="GPU"
            color="#22c55e"
            points={data.map((m) => m.gpu_pct)}
            latest={last?.gpu_pct != null ? `${last.gpu_pct}%` : "—"}
          />
          <Sparkline
            label="RAM"
            color="#f97316"
            points={data.map(ramPct)}
            latest={last ? `${gb(last.ram_used_mb)}/${gb(last.ram_total_mb)} GB` : "—"}
          />
          <Sparkline
            label="VRAM"
            color="#a855f7"
            points={data.map(vramPct)}
            latest={last ? `${gb(last.vram_used_mb)}/${gb(last.vram_total_mb)} GB` : "—"}
          />
        </div>
      )}
    </div>
  );
}
