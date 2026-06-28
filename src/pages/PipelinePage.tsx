import {
  Button,
  Card,
  CardContent,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  Select,
  Spinner,
} from "@chipmo-sentry/ui-kit";
import { Bell, RefreshCw, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  admin,
  type AdminAlert,
  type AdminAlertLevel,
  type AdminFeedbackVerdict,
} from "@/lib/api";

type Tone = "success" | "warning" | "danger" | "muted" | "info";

const TONE_COLOR: Record<Tone, string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  info: "var(--color-primary)",
  muted: "var(--color-muted-foreground)",
};

/** Soft tinted pill — colored text on a faint same-hue fill. */
function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const c = TONE_COLOR[tone];
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}
    >
      {children}
    </span>
  );
}

const CATEGORY_MN: Record<string, string> = {
  browsing: "Тойрч харах",
  cart_pickup: "Сагснаас авах",
  pocket_conceal: "Халаасанд нуух",
  bag_conceal: "Цүнхэнд нуух",
  other: "Бусад",
};

const LEVEL: Record<AdminAlertLevel, { label: string; tone: Tone }> = {
  ignore: { label: "Үл хэрэгсэх", tone: "muted" },
  log: { label: "Бүртгэв", tone: "muted" },
  notify: { label: "Мэдэгдэв", tone: "warning" },
  review: { label: "Хянах!", tone: "danger" },
};

const VERDICT: Record<AdminFeedbackVerdict, { label: string; tone: Tone }> = {
  true_positive: { label: "Зөв (TP)", tone: "success" },
  false_positive: { label: "Худал (FP)", tone: "danger" },
  unclear: { label: "Тодорхойгүй", tone: "warning" },
};

function triggerLabel(t: AdminAlert["triggered_by"]): string {
  return t === "live_threshold" ? "Шууд (босго)" : "Гар оруулга";
}
function catLabel(a: AdminAlert): string {
  if (a.actions && a.actions.length > 0)
    return a.actions.map((x) => CATEGORY_MN[x] ?? x).join(", ");
  return CATEGORY_MN[a.category] ?? a.category;
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("mn-MN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Superadmin pipeline ("Урсгал") — every problematic clip as ONE row, read
 * left→right as its journey: camera → behaviours (YOLO/engine) → VLM verdict →
 * decision (alert level) → human review. Click a row for the full trace.
 * Data: admin.listAlerts() (recent across all orgs); filtering is client-side. */
export function PipelinePage() {
  const [alerts, setAlerts] = useState<AdminAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminAlert | null>(null);

  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [verdict, setVerdict] = useState("");
  const [source, setSource] = useState("");
  const [camera, setCamera] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  async function reload() {
    try {
      setAlerts(await admin.listAlerts(150));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
    }
  }

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 15000);
    return () => clearInterval(id);
  }, []);

  const cameraNames = useMemo(() => {
    const s = new Set<string>();
    (alerts ?? []).forEach((a) => a.camera_name && s.add(a.camera_name));
    return Array.from(s).sort();
  }, [alerts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (alerts ?? []).filter((a) => {
      if (level && a.alert_level !== level) return false;
      if (source && a.triggered_by !== source) return false;
      if (camera && a.camera_name !== camera) return false;
      if (dateFrom && new Date(a.created_at) < new Date(`${dateFrom}T00:00:00`))
        return false;
      if (dateTo && new Date(a.created_at) > new Date(`${dateTo}T23:59:59`))
        return false;
      if (verdict === "__none" ? a.feedback_verdict !== null : verdict && a.feedback_verdict !== verdict)
        return false;
      if (q) {
        const hay = [
          a.id,
          a.camera_name,
          a.organization_name,
          a.store_name,
          a.reasoning,
          catLabel(a),
          (a.triggered_behaviors ?? []).join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [alerts, search, level, verdict, source, camera, dateFrom, dateTo]);

  const filtersActive = !!(
    search ||
    level ||
    verdict ||
    source ||
    camera ||
    dateFrom ||
    dateTo
  );

  if (error && !alerts)
    return <p className="p-8 text-(--color-danger)">{error}</p>;
  if (!alerts)
    return (
      <div className="p-8">
        <Spinner />
      </div>
    );

  const reviewCount = alerts.filter((a) => a.alert_level === "review").length;
  const fpCount = alerts.filter((a) => a.feedback_verdict === "false_positive").length;
  const pendingCount = alerts.filter((a) => a.feedback_verdict === null).length;

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Workflow className="h-6 w-6 text-(--color-primary)" />
            <h1 className="text-2xl font-semibold">Урсгал</h1>
          </div>
          <p className="mt-1 text-sm text-(--color-muted-foreground)">
            Асуудалтай бичлэг бүрийн аялал: камер → зан үйл (YOLO/engine) → VLM
            шалгалт → шийдвэр → хяналт. Мөр дээр дарж дэлгэрэнгүйг үзнэ.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          <RefreshCw className="h-4 w-4" />
          Шинэчлэх
        </Button>
      </div>

      {error && <p className="text-sm text-(--color-danger)">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Бичлэг (сүүлийн)" value={String(alerts.length)} />
        <Kpi label="Хянах түвшин" value={String(reviewCount)} accent={reviewCount ? TONE_COLOR.danger : undefined} />
        <Kpi label="Худал (FP)" value={String(fpCount)} accent={fpCount ? TONE_COLOR.danger : undefined} />
        <Kpi label="Хүлээгдэж буй хяналт" value={String(pendingCount)} accent={pendingCount ? TONE_COLOR.warning : undefined} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Хайх (камер, байгууллага, шалтгаан, ID)…"
          className="max-w-xs"
        />
        <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-auto">
          <option value="">Бүх түвшин</option>
          <option value="review">Хянах</option>
          <option value="notify">Мэдэгдэв</option>
          <option value="log">Бүртгэв</option>
          <option value="ignore">Үл хэрэгсэх</option>
        </Select>
        <Select value={verdict} onChange={(e) => setVerdict(e.target.value)} className="w-auto">
          <option value="">Бүх хяналт</option>
          <option value="__none">Хүлээгдэж буй</option>
          <option value="true_positive">Зөв (TP)</option>
          <option value="false_positive">Худал (FP)</option>
          <option value="unclear">Тодорхойгүй</option>
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-auto">
          <option value="">Бүх эх үүсвэр</option>
          <option value="live_threshold">Шууд (босго)</option>
          <option value="manual_upload">Гар оруулга</option>
        </Select>
        <Select value={camera} onChange={(e) => setCamera(e.target.value)} className="w-auto">
          <option value="">Бүх камер</option>
          {cameraNames.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-(--color-muted-foreground)">Огноо</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-auto"
            aria-label="Эхлэх огноо"
          />
          <span className="text-xs text-(--color-muted-foreground)">–</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-auto"
            aria-label="Дуусах огноо"
          />
        </div>
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setLevel("");
              setVerdict("");
              setSource("");
              setCamera("");
              setDateFrom("");
              setDateTo("");
            }}
          >
            Цэвэрлэх
          </Button>
        )}
        <span className="ml-auto text-xs text-(--color-muted-foreground)">
          {filtered.length} / {alerts.length}
        </span>
      </div>

      {/* Trace table */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-(--color-muted-foreground)">
            {alerts.length === 0
              ? "Асуудалтай бичлэг алга."
              : "Шүүлтэд тохирох бичлэг алга."}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-(--color-border)">
          <table className="w-full text-sm">
            <thead className="border-b border-(--color-border) bg-(--color-muted) text-xs uppercase tracking-wider text-(--color-muted-foreground)">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Бичлэг</th>
                <th className="px-3 py-2 text-left font-medium">Камер</th>
                <th className="px-3 py-2 text-left font-medium">Эх үүсвэр</th>
                <th className="px-3 py-2 text-left font-medium">Зан үйл</th>
                <th className="px-3 py-2 text-left font-medium">VLM шалгалт</th>
                <th className="px-3 py-2 text-left font-medium">Шийдвэр</th>
                <th className="px-3 py-2 text-left font-medium">Хяналт</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const lvl = LEVEL[a.alert_level];
                const vrd = a.feedback_verdict ? VERDICT[a.feedback_verdict] : null;
                const behaviors = a.triggered_behaviors ?? [];
                return (
                  <tr
                    key={a.id}
                    onClick={() => setSelected(a)}
                    className="cursor-pointer border-t border-(--color-border) hover:bg-(--color-muted)/50"
                  >
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-mono text-xs">{a.id.slice(0, 8)}</div>
                      <div className="text-xs text-(--color-muted-foreground)">
                        {fmtTime(a.created_at)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium">{a.camera_name ?? "—"}</div>
                      <div className="text-xs text-(--color-muted-foreground)">
                        {a.organization_name}
                        {a.store_name ? ` · ${a.store_name}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div>{triggerLabel(a.triggered_by)}</div>
                      {a.peak_risk_pct != null && (
                        <div className="text-xs text-(--color-muted-foreground)">
                          peak {a.peak_risk_pct.toFixed(0)}%
                        </div>
                      )}
                    </td>
                    <td className="max-w-xs px-3 py-2.5 align-top">
                      {behaviors.length === 0 ? (
                        <span className="text-xs text-(--color-muted-foreground)">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {behaviors.slice(0, 3).map((b) => (
                            <span
                              key={b}
                              className="rounded bg-(--color-muted) px-1.5 py-0.5 font-mono text-[11px]"
                            >
                              {b}
                            </span>
                          ))}
                          {behaviors.length > 3 && (
                            <span className="text-[11px] text-(--color-muted-foreground)">
                              +{behaviors.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="max-w-xs px-3 py-2.5 align-top">
                      <div>{catLabel(a)}</div>
                      <div className="text-xs text-(--color-muted-foreground)">
                        {a.confidence.toFixed(2)} · {a.model_name} ·{" "}
                        {a.inference_latency_ms}ms
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Pill tone={lvl.tone}>{lvl.label}</Pill>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {vrd ? (
                        <Pill tone={vrd.tone}>{vrd.label}</Pill>
                      ) : (
                        <span className="text-xs text-(--color-muted-foreground)">
                          Хүлээгдэж
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AlertTraceModal alert={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-(--color-border) p-3">
      <div className="text-xs text-(--color-muted-foreground)">{label}</div>
      <div className="mt-0.5 text-xl font-semibold" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
    </div>
  );
}

/** Stage block in the detail modal: a labeled step of the clip's journey. */
function Stage({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-(--color-border) p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-(--color-muted-foreground)">
        {icon}
        {title}
      </div>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-(--color-muted-foreground)">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

/** Full pipeline trace for one clip — the journey end to end. */
function AlertTraceModal({
  alert: a,
  onClose,
}: {
  alert: AdminAlert | null;
  onClose: () => void;
}) {
  return (
    <Modal open={a !== null} onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-2xl">
        {a && (
          <>
            <ModalHeader>
              <ModalTitle className="flex flex-wrap items-center gap-2">
                <Bell className="h-4 w-4 text-(--color-primary)" />
                Бичлэгийн аялал
                <code className="rounded bg-(--color-muted) px-1.5 py-0.5 text-xs font-normal">
                  {a.id.slice(0, 8)}
                </code>
                <span className="text-sm font-normal text-(--color-muted-foreground)">
                  {new Date(a.created_at).toLocaleString("mn-MN")}
                </span>
              </ModalTitle>
            </ModalHeader>

            <div className="space-y-3">
              <Stage icon={<Workflow className="h-3.5 w-3.5" />} title="Эх үүсвэр — камер">
                <Row k="Камер" v={a.camera_name ?? "—"} />
                <Row
                  k="Байгууллага"
                  v={a.organization_name + (a.store_name ? ` · ${a.store_name}` : "")}
                />
                <Row k="Эх үүсвэр" v={triggerLabel(a.triggered_by)} />
                {a.peak_risk_pct != null && (
                  <Row k="Хамгийн өндөр эрсдэл" v={`${a.peak_risk_pct.toFixed(0)}%`} />
                )}
              </Stage>

              <Stage icon={<Workflow className="h-3.5 w-3.5" />} title="Зан үйл (YOLO / engine)">
                {(a.triggered_behaviors ?? []).length === 0 &&
                (a.triggered_sequences ?? []).length === 0 ? (
                  <span className="text-(--color-muted-foreground)">
                    Зан үйл бүртгэгдээгүй (гар оруулга байж магадгүй).
                  </span>
                ) : (
                  <>
                    {(a.triggered_behaviors ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {a.triggered_behaviors!.map((b) => (
                          <span
                            key={b}
                            className="rounded bg-(--color-muted) px-1.5 py-0.5 font-mono text-[11px]"
                          >
                            {b}
                          </span>
                        ))}
                      </div>
                    )}
                    {(a.triggered_sequences ?? []).length > 0 && (
                      <Row k="Дараалал" v={a.triggered_sequences!.join(" → ")} />
                    )}
                    {(a.triggered_behavior_detail ?? []).length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {a.triggered_behavior_detail!.map((d, i) => (
                          <div
                            key={i}
                            className="flex justify-between gap-3 text-xs text-(--color-muted-foreground)"
                          >
                            <span className="font-mono">{d.key}</span>
                            <span>
                              +{d.offset_sec.toFixed(1)}с · {d.score.toFixed(0)} оноо
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </Stage>

              <Stage icon={<Workflow className="h-3.5 w-3.5" />} title="VLM шалгалт">
                <Row k="Дүгнэлт" v={catLabel(a)} />
                <Row k="Итгэл" v={a.confidence.toFixed(2)} />
                <Row k="Модель" v={`${a.model_name} · ${a.inference_latency_ms}ms`} />
                {a.reasoning && (
                  <p className="mt-1 rounded bg-(--color-muted) px-2 py-1.5 text-xs leading-relaxed">
                    {a.reasoning}
                  </p>
                )}
              </Stage>

              <Stage icon={<Bell className="h-3.5 w-3.5" />} title="Шийдвэр ба хяналт">
                <Row k="Түвшин" v={<Pill tone={LEVEL[a.alert_level].tone}>{LEVEL[a.alert_level].label}</Pill>} />
                <Row
                  k="Хяналт"
                  v={
                    a.feedback_verdict ? (
                      <Pill tone={VERDICT[a.feedback_verdict].tone}>
                        {VERDICT[a.feedback_verdict].label}
                      </Pill>
                    ) : (
                      <span className="text-(--color-muted-foreground)">Хүлээгдэж</span>
                    )
                  }
                />
                <Row k="Clip ID" v={<code className="text-xs">{a.clip_id.slice(0, 8)}</code>} />
              </Stage>
            </div>

            <div className="mt-4 flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Хаах
              </Button>
            </div>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
