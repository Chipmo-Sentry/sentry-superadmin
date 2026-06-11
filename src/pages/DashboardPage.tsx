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

import { admin, type AlertAnalytics, type FeedbackAnalytics } from "@/lib/api";
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
          <AlertAnalyticsSection />
          <FeedbackAnalyticsSection />
        </>
      ) : null}
    </div>
  );
}
