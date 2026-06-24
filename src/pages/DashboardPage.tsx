import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from "@chipmo-sentry/ui-kit";
import {
  Bell,
  Building2,
  Cctv,
  Cpu,
  ShieldAlert,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  admin,
  type AlertAnalytics,
  type FeedbackAnalytics,
  type QualityAnalytics,
} from "@/lib/api";
import { categoryLabel } from "@/lib/labels";
import type { AdminStats } from "@/lib/types";

const CARDS: { key: keyof AdminStats; label: string; icon: LucideIcon }[] = [
  { key: "orgs", label: "Байгууллага", icon: Building2 },
  { key: "users", label: "Хэрэглэгч", icon: Users },
  { key: "stores", label: "Дэлгүүр", icon: Store },
  { key: "cameras", label: "Камер", icon: Cctv },
  { key: "cameras_enabled", label: "Идэвхтэй камер", icon: Cctv },
  { key: "ai_nodes_online", label: "AI сервер (online)", icon: Cpu },
  { key: "alerts", label: "Нийт сэжиг", icon: Bell },
  { key: "alerts_24h", label: "Сэжиг (24ц)", icon: ShieldAlert },
];

const CATEGORY_COLORS: Record<string, string> = {
  browsing: "#3b82f6",
  cart_pickup: "#f59e0b",
  pocket_conceal: "#ef4444",
  other: "#94a3b8",
};

function AlertAnalyticsSection() {
  const [data, setData] = useState<AlertAnalytics | null>(null);
  const [range, setRange] = useState("7d");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    admin.alertAnalytics(range).then(
      (d) => !cancelled && setData(d),
      (e) => !cancelled && setError(e instanceof Error ? e.message : "Алдаа"),
    );
    return () => {
      cancelled = true;
    };
  }, [range]);

  const ranges = [
    { k: "24h", l: "24ц" },
    { k: "7d", l: "7 хон" },
    { k: "30d", l: "30 хон" },
  ];
  const cats = data
    ? Object.entries(data.by_category).sort((a, b) => b[1] - a[1])
    : [];
  const max = cats.reduce((m, [, n]) => Math.max(m, n), 0) || 1;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Сэжигтэй үйлдлийн задаргаа</CardTitle>
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r.k}
              onClick={() => setRange(r.k)}
              className={`rounded px-2 py-0.5 text-xs ${
                range === r.k
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
              }`}
            >
              {r.l}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        ) : data === null ? (
          <Spinner />
        ) : data.total === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Энэ хугацаанд сэжигтэй үйлдэл бүртгэгдээгүй.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="text-sm text-[var(--color-muted-foreground)]">
              Нийт <span className="font-semibold text-[var(--color-foreground)]">{data.total}</span> сэжиг
            </div>
            {cats.map(([cat, n]) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm">
                  {categoryLabel(cat)}
                </span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-[var(--color-muted)]">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${(n / max) * 100}%`,
                      backgroundColor: CATEGORY_COLORS[cat] ?? "#94a3b8",
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FeedbackAnalyticsSection() {
  const [data, setData] = useState<FeedbackAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    admin.feedbackAnalytics("30d").then(
      (d) => !cancelled && setData(d),
      (e) => !cancelled && setError(e instanceof Error ? e.message : "Алдаа"),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const cats = data
    ? Object.entries(data.by_category).sort((a, b) => b[1].fp_rate - a[1].fp_rate)
    : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Ажилтны санал → загвар сайжруулалт <span className="text-xs font-normal text-[var(--color-muted-foreground)]">(30 хоног)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        ) : data === null ? (
          <Spinner />
        ) : data.total === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Ажилтнууд сэжгийг зөв/худал гэж тэмдэглэхэд энд статистик + тааруулах санал гарч ирнэ.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-4 text-sm">
              <span className="text-[#22c55e]">✓ Зөв: {data.totals.true_positive}</span>
              <span className="text-[#ef4444]">✗ Худал: {data.totals.false_positive}</span>
              <span className="text-[var(--color-muted-foreground)]">? Тодорхойгүй: {data.totals.unclear}</span>
            </div>
            <div className="space-y-1.5">
              {cats.map(([cat, c]) => (
                <div key={cat} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0">{categoryLabel(cat)}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded bg-[var(--color-muted)]">
                    <div className="h-full bg-[#ef4444]" style={{ width: `${c.fp_rate * 100}%` }} />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs text-[var(--color-muted-foreground)]">
                    {Math.round(c.fp_rate * 100)}% худал ({c.total})
                  </span>
                </div>
              ))}
            </div>
            {data.suggestions.length > 0 && (
              <div className="space-y-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] p-3">
                <div className="text-sm font-medium">💡 Тааруулах санал</div>
                {data.suggestions.map((s) => (
                  <p key={s.category} className="text-xs text-[var(--color-muted-foreground)]">
                    {s.hint}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DetectionQualitySection() {
  const [data, setData] = useState<QualityAnalytics | null>(null);
  const [range, setRange] = useState("30d");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    admin.qualityAnalytics(range).then(
      (d) => !cancelled && setData(d),
      (e) => !cancelled && setError(e instanceof Error ? e.message : "Алдаа"),
    );
    return () => {
      cancelled = true;
    };
  }, [range]);

  const ranges = [
    { k: "24h", l: "24ц" },
    { k: "7d", l: "7 хоног" },
    { k: "30d", l: "30 хоног" },
  ];
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">Илрүүлэлтийн чанар</CardTitle>
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r.k}
              onClick={() => setRange(r.k)}
              className={`rounded px-2 py-1 text-xs ${
                range === r.k
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
              }`}
            >
              {r.l}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        ) : data === null ? (
          <Spinner />
        ) : data.labeled === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Ажилтнууд сэжгийг зөв/худал гэж тэмдэглэхэд илрүүлэлтийн нарийвчлал (precision),
            итгэлийн калибровк, өдрийн худал дохио энд гарч ирнэ. ({data.total_alerts} сэжиг,
            0 шошготой)
          </p>
        ) : (
          <div className="space-y-5">
            {/* headline metric tiles */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-[var(--radius)] bg-[var(--color-muted)] p-3">
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  Нарийвчлал (precision)
                </div>
                <div className="text-2xl font-semibold tabular-nums">{pct(data.precision)}</div>
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  ✓{data.tp} / ✗{data.fp}
                </div>
              </div>
              <div className="rounded-[var(--radius)] bg-[var(--color-muted)] p-3">
                <div className="text-xs text-[var(--color-muted-foreground)]">Хянасан хувь</div>
                <div className="text-2xl font-semibold tabular-nums">{pct(data.coverage)}</div>
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  {data.labeled} / {data.total_alerts} сэжиг
                </div>
              </div>
              <div className="rounded-[var(--radius)] bg-[var(--color-muted)] p-3">
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  Худал дохио / хоног
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {data.false_alerts_per_day}
                </div>
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  ажилтанд харагдсан
                </div>
              </div>
            </div>

            {/* per-category precision */}
            {data.by_category.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Ангилал бүрийн нарийвчлал</div>
                {data.by_category.map((c) => (
                  <div key={c.category} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0">{categoryLabel(c.category)}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded bg-[var(--color-muted)]">
                      <div
                        className="h-full bg-[#22c55e]"
                        style={{ width: `${(c.precision ?? 0) * 100}%` }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs text-[var(--color-muted-foreground)]">
                      {pct(c.precision)} зөв (✓{c.tp}/✗{c.fp})
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* confidence calibration — does the model's confidence track truth? */}
            <div className="space-y-1.5">
              <div className="text-sm font-medium">
                Итгэлийн калибровк{" "}
                <span className="text-xs font-normal text-[var(--color-muted-foreground)]">
                  (өндөр итгэл → өндөр зөв байх ёстой)
                </span>
              </div>
              {data.by_confidence.map((b) => (
                <div key={b.bucket} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 tabular-nums">{b.bucket}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded bg-[var(--color-muted)]">
                    <div
                      className="h-full bg-[var(--color-primary)]"
                      style={{ width: `${(b.tp_rate ?? 0) * 100}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs text-[var(--color-muted-foreground)]">
                    {b.tp_rate === null ? "— дата алга" : `${pct(b.tp_rate)} зөв`} (
                    {b.tp + b.fp})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    admin
      .stats()
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : "Алдаа"));
  }, []);

  return (
    <div className="space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Хяналтын самбар</h1>
      {error && <p className="text-[var(--color-danger)]">{error}</p>}
      {stats === null && !error ? (
        <Spinner />
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {CARDS.map(({ key, label, icon: Icon }) => (
              <Card key={key}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm text-[var(--color-muted-foreground)]">
                    {label}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                </CardHeader>
                <CardContent>
                  <span className="text-3xl font-semibold tabular-nums">
                    {stats[key]}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
          <DetectionQualitySection />
          <AlertAnalyticsSection />
          <FeedbackAnalyticsSection />
        </>
      ) : null}
    </div>
  );
}
