import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
} from "@chipmo-sentry/ui-kit";
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ListOrdered,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { behaviors } from "@/lib/api";
import type { BehaviorConfig, BehaviorDimension } from "@/lib/types";

// v2 (ADR-0024): criteria grouped by severity level; absolute 0-100 score with
// 4 risk levels. Defaults match backend DEFAULT_THRESHOLDS.
const DEF_GREEN = 10;
const DEF_YELLOW = 25;
const DEF_HIGH = 50;

const LEVELS: { n: number; title: string }[] = [
  { n: 1, title: "Түвшин 1 — Сэжигтэй зан" },
  { n: 2, title: "Түвшин 2 — Нуун далдлах" },
  { n: 3, title: "Түвшин 3 — Зохион байгуулалттай" },
  { n: 4, title: "Түвшин 4 — Ноцтой үйлдэл" },
];

// Global engine knobs (mirror sentry-ai behavior.DEFAULT_ENGINE) with Mongolian
// labels + sensible step sizes for the number inputs.
const ENGINE_FIELDS: { key: string; label: string; step: number; hint: string }[] = [
  { key: "smooth_frames", label: "Тогтворжилт", step: 1, hint: "Оноо өгөхөөс өмнө дохио дараалан илрэх frame (давтамж)" },
  { key: "decay_idle", label: "Бууралт (сул)", step: 0.005, hint: "Бараа барихгүй үед оноо frame тутам ийш үржинэ (0–1)" },
  { key: "decay_holding", label: "Бууралт (барьсан)", step: 0.001, hint: "Бараа барьсан үед оноо удаан буурна (0–1)" },
  { key: "sequence_window_sec", label: "Дарааллын цонх (сек)", step: 5, hint: "Үйлдлүүд энэ хугацаанд дараалбал bonus" },
  { key: "loiter_radius_frac", label: "Зогсолтын радиус", step: 0.05, hint: "Нэг байранд тооцох радиус (биеийн өндрийн харьцаа)" },
  { key: "stale_track_sec", label: "Track хадгалах (сек)", step: 1, hint: "Хүн алга болсны дараа төлөвийг хадгалах хугацаа" },
];

// Friendly Mongolian labels for per-detector params. Unknown keys fall back to
// the raw key so a future sentry-ai param still renders an editable input.
const PARAM_LABELS: Record<string, string> = {
  offset_frac: "Хазайлт (өндрийн %)",
  collapse_frac: "Мөр нарийсалт",
  ema_alpha: "Тэгшитгэл",
  frac: "Мэдрэмж (өндрийн %)",
  hold_floor: "Доод оноо (барьсан)",
  cadence: "Давтамж (frame)",
  radius_frac: "Радиус (өндрийн %)",
  seconds: "Хугацаа (сек)",
};

/** True if two numeric maps differ over the union of their keys. */
function numMapsDiffer(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return true;
  return false;
}

/** Super-admin editor for the behavior catalog. Each criterion is edited IN ITS
 * ROW and saved on its own (PATCH /dimensions/{key} — weight + active + params in
 * one call), so the node picks the change up within ~30s. The global risk
 * thresholds + engine knobs live in a separate collapsible section with their own
 * save, so a per-row edit never clobbers an unsaved global edit (and vice-versa).
 * The backend PATCH endpoints are super-admin gated. */
export function BehaviorsPage() {
  const [data, setData] = useState<BehaviorConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function hydrate(j: BehaviorConfig) {
    setData(j);
  }

  useEffect(() => {
    let cancelled = false;
    behaviors.get().then(
      (j) => {
        if (!cancelled) hydrate(j);
      },
      (e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Алдаа");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const [addOpen, setAddOpen] = useState(false);

  if (err && !data)
    return <p className="p-8 text-[var(--color-danger)]">{err}</p>;
  if (!data) {
    return (
      <div className="p-8">
        <Spinner />
      </div>
    );
  }

  const detectorCount = data.dimensions.filter((d) => d.has_detector).length;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Brain className="h-6 w-6 text-[var(--color-primary)]" />
            <h1 className="text-2xl font-semibold">Зан үйлийн engine v2</h1>
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            AI {detectorCount} / {data.dimensions.length} детектортой шалгуураар
            0–100 эрсдэлийн оноо тооцож, дараалал илрэхэд нэмэлт оноо өгнө. Мөр
            бүрийг шууд засаад <strong>Хадгалах</strong> дарна — sentry-ai ~30
            секундэд хүлээн авна. Жин ↑ = илүү мэдрэмжтэй.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Шалгуур нэмэх
        </Button>
      </div>

      {err && <p className="mb-4 text-sm text-[var(--color-danger)]">{err}</p>}

      {/* Criteria grouped by level — each ROW saves itself. */}
      {LEVELS.map((lvl) => {
        const dims = data.dimensions.filter((d) => (d.level ?? 1) === lvl.n);
        if (dims.length === 0) return null;
        return (
          <Card key={lvl.n} className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">{lvl.title}</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pt-0">
              <table className="w-full text-sm">
                <thead className="border-y border-[var(--color-border)] bg-[var(--color-muted)] text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Шалгуур</th>
                    <th className="px-3 py-2 text-center font-medium">Детектор</th>
                    <th className="px-3 py-2 text-center font-medium">Идэвх</th>
                    <th className="px-3 py-2 text-right font-medium">Жин</th>
                    <th className="px-3 py-2 text-right font-medium">Хадгалах</th>
                  </tr>
                </thead>
                <tbody>
                  {dims.map((d) => (
                    <BehaviorRow
                      key={d.key}
                      d={d}
                      onSaved={hydrate}
                      onError={setErr}
                    />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}

      {/* Global config (thresholds + engine) — collapsible, own save. */}
      <GlobalConfigSection data={data} onSaved={hydrate} onError={setErr} />

      {/* Sequence rules (read-only) */}
      {data.sequences && data.sequences.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListOrdered className="h-4 w-4" />
              Дарааллын дүрэм (нэмэлт оноо)
            </CardTitle>
            <CardDescription>
              Зан үйлүүд эдгээр дарааллаар илрэхэд нэмэлт оноо нэмэгдэнэ.
              Дараалал нь ганц детекторын оноогоос давуу эрхтэй.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.sequences.map((s) => (
                <li
                  key={s.key}
                  className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2"
                >
                  <span className="flex flex-wrap items-center gap-1.5 text-sm">
                    {s.pattern.map((p, i) => (
                      <span key={i} className="flex items-center gap-1.5">
                        {i > 0 && (
                          <span className="text-[var(--color-muted-foreground)]">
                            →
                          </span>
                        )}
                        <code className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 text-xs">
                          {p}
                        </code>
                      </span>
                    ))}
                  </span>
                  <Badge tone="success">+{s.bonus}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <AddCriterionModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={(fresh) => {
          hydrate(fresh);
          setAddOpen(false);
        }}
        onError={(m) => setErr(m)}
      />
    </div>
  );
}

/** One self-saving criterion row: weight + active toggle + per-detector params,
 * all persisted together in a single PATCH /dimensions/{key} when the operator
 * clicks Хадгалах. Local edits are never clobbered by a sibling row's save (the
 * row only re-seeds from the server when it has no pending edit). */
function BehaviorRow({
  d,
  onSaved,
  onError,
}: {
  d: BehaviorDimension;
  onSaved: (fresh: BehaviorConfig) => void;
  onError: (msg: string) => void;
}) {
  const [weight, setWeight] = useState(d.weight);
  const [active, setActive] = useState(d.active);
  const [params, setParams] = useState<Record<string, number>>({
    ...(d.params ?? {}),
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const dirty =
    weight !== d.weight ||
    active !== d.active ||
    numMapsDiffer(params, d.params ?? {});

  // Absorb external updates (catalog reconcile, another row's save returning the
  // full config) ONLY when this row has no unsaved edit — so editing one row can
  // never silently discard what you typed in another.
  const dParamsKey = JSON.stringify(d.params ?? {});
  useEffect(() => {
    if (dirty) return;
    setWeight(d.weight);
    setActive(d.active);
    setParams({ ...(d.params ?? {}) });
    setSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.weight, d.active, dParamsKey]);

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    onError("");
    try {
      const fresh = await behaviors.updateDimension(d.key, {
        weight,
        active,
        params,
      });
      onSaved(fresh);
      setSavedAt(new Date().toLocaleTimeString("mn-MN"));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Хадгалах амжилтгүй");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    onError("");
    try {
      onSaved(await behaviors.deleteDimension(d.key));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Устгаж чадсангүй");
    } finally {
      setSaving(false);
    }
  }

  const paramKeys = Object.keys(params).sort();

  return (
    <Fragment>
      <tr
        className={`border-b border-[var(--color-border)] ${
          !active ? "opacity-60" : ""
        }`}
      >
        <td className="px-3 py-3 align-top">
          <div className="font-medium">{d.label_mn}</div>
          <code className="mt-0.5 inline-block rounded bg-[var(--color-muted)] px-1.5 py-0.5 text-xs">
            {d.key}
          </code>
          {d.description_mn && (
            <p className="mt-1 max-w-md text-xs text-[var(--color-muted-foreground)]">
              {d.description_mn}
            </p>
          )}
        </td>
        <td className="px-3 py-3 align-top text-center">
          {d.has_detector ? (
            <Badge tone="success">
              <CheckCircle2 className="h-3 w-3" /> Детектортой
            </Badge>
          ) : (
            <Badge tone="warning">
              <Clock className="h-3 w-3" /> Хүлээгдэж
            </Badge>
          )}
        </td>
        <td className="px-3 py-3 align-top text-center">
          <input
            type="checkbox"
            checked={active}
            disabled={saving}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4"
            aria-label="Идэвхжүүлэх"
          />
        </td>
        <td className="px-3 py-3 align-top text-right">
          <input
            type="number"
            step="0.5"
            min="0"
            value={weight}
            disabled={saving}
            onChange={(e) => setWeight(Number(e.target.value) || 0)}
            className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-right font-mono text-sm focus:border-[var(--color-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]/30"
          />
        </td>
        <td className="px-3 py-3 align-top text-right">
          <div className="flex items-center justify-end gap-2">
            {dirty ? (
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                <Save className="h-3.5 w-3.5" />
                {saving ? "Хадгалж..." : "Хадгалах"}
              </Button>
            ) : savedAt ? (
              <span className="whitespace-nowrap text-xs text-[var(--color-success)]">
                ✓ {savedAt}
              </span>
            ) : null}
            {!d.builtin && (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Устгах"
                disabled={saving}
                onClick={() => void remove()}
              >
                <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
              </Button>
            )}
          </div>
        </td>
      </tr>
      {d.has_detector && paramKeys.length > 0 && (
        <tr
          className={`border-b border-[var(--color-border)] bg-[var(--color-muted)]/40 ${
            !active ? "opacity-60" : ""
          }`}
        >
          <td colSpan={5} className="px-3 pb-3 pt-0">
            <div className="flex flex-wrap items-end gap-3">
              <span className="pt-4 text-xs text-[var(--color-muted-foreground)]">
                Нарийн тохиргоо:
              </span>
              {paramKeys.map((pk) => (
                <label key={pk} className="flex flex-col gap-0.5">
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    {PARAM_LABELS[pk] ?? pk}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={params[pk] ?? ""}
                    disabled={saving}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      setParams((prev) => ({ ...prev, [pk]: val }));
                    }}
                    className="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-right font-mono text-xs focus:border-[var(--color-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]/30"
                  />
                </label>
              ))}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** Collapsible global section: 4-level risk thresholds + engine knobs. One bulk
 * save (PATCH /behaviors), isolated from the per-row criterion edits above. */
function GlobalConfigSection({
  data,
  onSaved,
  onError,
}: {
  data: BehaviorConfig;
  onSaved: (fresh: BehaviorConfig) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [greenMax, setGreenMax] = useState(data.thresholds.green_max ?? DEF_GREEN);
  const [yellowMax, setYellowMax] = useState(
    data.thresholds.yellow_max ?? DEF_YELLOW,
  );
  const [highMax, setHighMax] = useState(data.thresholds.high_max ?? DEF_HIGH);
  const [engine, setEngine] = useState<Record<string, number>>({
    ...(data.engine ?? {}),
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const ll = data.level_labels ?? {
    LOW: "Бага",
    MEDIUM: "Дунд",
    HIGH: "Өндөр",
    CRITICAL: "Ноцтой",
  };

  const dirty =
    greenMax !== (data.thresholds.green_max ?? DEF_GREEN) ||
    yellowMax !== (data.thresholds.yellow_max ?? DEF_YELLOW) ||
    highMax !== (data.thresholds.high_max ?? DEF_HIGH) ||
    numMapsDiffer(engine, data.engine ?? {});

  const thresholdValid = greenMax >= 0 && yellowMax > greenMax && highMax > yellowMax;

  // Absorb server truth only when there's no pending global edit.
  const engineKey = JSON.stringify(data.engine ?? {});
  useEffect(() => {
    if (dirty) return;
    setGreenMax(data.thresholds.green_max ?? DEF_GREEN);
    setYellowMax(data.thresholds.yellow_max ?? DEF_YELLOW);
    setHighMax(data.thresholds.high_max ?? DEF_HIGH);
    setEngine({ ...(data.engine ?? {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data.thresholds.green_max,
    data.thresholds.yellow_max,
    data.thresholds.high_max,
    engineKey,
  ]);

  async function save() {
    if (!dirty || !thresholdValid || saving) return;
    setSaving(true);
    onError("");
    try {
      const fresh = await behaviors.patch({
        thresholds: { green_max: greenMax, yellow_max: yellowMax, high_max: highMax },
        engine,
      });
      onSaved(fresh);
      setSavedAt(new Date().toLocaleTimeString("mn-MN"));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Хадгалах амжилтгүй");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {open ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Глобал тохиргоо — эрсдэлийн босго ба engine
            </CardTitle>
            <CardDescription className="mt-1">
              Бүх камерт хамаарах түвшний босго + engine параметрүүд. Цаг ховор
              өөрчилдөг тул тусдаа хадгална.
            </CardDescription>
          </div>
          {dirty && (
            <Badge tone="warning">Хадгалаагүй</Badge>
          )}
        </button>
      </CardHeader>
      {open && (
        <CardContent>
          {/* 4-level thresholds (absolute 0-100) */}
          <div className="mb-2 text-sm font-medium">Эрсдэлийн түвшний босго (0–100)</div>
          <div className="grid gap-4 sm:grid-cols-4">
            <LevelInput
              color="bg-green-500"
              label={ll.LOW ?? "Бага"}
              hint={`оноо < ${greenMax}`}
              value={greenMax}
              onChange={setGreenMax}
            />
            <LevelInput
              color="bg-yellow-500"
              label={ll.MEDIUM ?? "Дунд"}
              hint={`${greenMax} ≤ оноо < ${yellowMax}`}
              value={yellowMax}
              onChange={setYellowMax}
            />
            <LevelInput
              color="bg-orange-500"
              label={ll.HIGH ?? "Өндөр"}
              hint={`${yellowMax} ≤ оноо < ${highMax}`}
              value={highMax}
              onChange={setHighMax}
            />
            <div className="rounded-md border border-[var(--color-border)] p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" />
                <span className="text-sm font-medium">{ll.CRITICAL ?? "Ноцтой"}</span>
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                оноо ≥ {highMax} → автомат clip + VLM шалгалт + alert
              </p>
            </div>
          </div>
          {!thresholdValid && (
            <p className="mt-3 text-xs text-[var(--color-danger)]">
              Босгууд өсөх дарааллаар байх ёстой: Бага &lt; Дунд &lt; Өндөр.
            </p>
          )}

          {/* Engine knobs */}
          <div className="mb-2 mt-6 text-sm font-medium">Engine нарийн тохиргоо</div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ENGINE_FIELDS.map((f) => (
              <div
                key={f.key}
                className="rounded-md border border-[var(--color-border)] p-3"
              >
                <div className="text-sm font-medium">{f.label}</div>
                <p className="mb-2 text-xs text-[var(--color-muted-foreground)]">
                  {f.hint}
                </p>
                <input
                  type="number"
                  step={f.step}
                  min={0}
                  value={engine[f.key] ?? ""}
                  onChange={(e) =>
                    setEngine((prev) => ({
                      ...prev,
                      [f.key]: Number(e.target.value) || 0,
                    }))
                  }
                  className="w-28 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-right font-mono text-sm focus:border-[var(--color-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]/30"
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-end gap-3">
            {savedAt && !dirty && (
              <span className="text-xs text-[var(--color-success)]">
                Хадгалагдсан · {savedAt}
              </span>
            )}
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={!dirty || !thresholdValid || saving}
            >
              <Save className="h-4 w-4" />
              {saving ? "Хадгалж байна..." : "Глобал тохиргоо хадгалах"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

const CATEGORIES: { value: string; label: string; level: number }[] = [
  { value: "suspicious", label: "Сэжигтэй (Түвшин 1)", level: 1 },
  { value: "concealment", label: "Нуун далдлах (Түвшин 2)", level: 2 },
  { value: "organized", label: "Зохион байгуулалттай (Түвшин 3)", level: 3 },
  { value: "critical", label: "Ноцтой (Түвшин 4)", level: 4 },
];

function AddCriterionModal({
  open,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (fresh: BehaviorConfig) => void;
  onError: (msg: string) => void;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState(1);
  const [category, setCategory] = useState("suspicious");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKey("");
    setLabel("");
    setDescription("");
    setWeight(1);
    setCategory("suspicious");
  }, [open]);

  const keyValid = /^[a-z][a-z0-9_]{1,39}$/.test(key);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyValid || !label.trim()) return;
    setSaving(true);
    try {
      const cat = CATEGORIES.find((c) => c.value === category);
      const fresh = await behaviors.addDimension({
        key,
        label_mn: label.trim(),
        description_mn: description.trim(),
        weight,
        category,
        level: cat?.level ?? 1,
      });
      onSaved(fresh);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Нэмж чадсангүй");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Шинэ сэжиг шалгуур</ModalTitle>
        </ModalHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <p className="rounded-md bg-[var(--color-muted)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
            Анхаар: AI энэ шалгуурыг бодитоор илрүүлэхийн тулд sentry-ai-д тухайн
            түлхүүрийн <strong>детектор код</strong> нэмэгдсэн байх ёстой. Тэр
            болтол шалгуур бүртгэгдэх ч оноо нэмэхгүй.
          </p>
          <Field
            label="Түлхүүр (key)"
            required
            hint="латин жижиг үсэг/тоо/_; үсгээр эхэлнэ"
          >
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="ж: loitering"
              disabled={saving}
              autoComplete="off"
            />
          </Field>
          {key && !keyValid && (
            <p className="text-xs text-[var(--color-danger)]">
              Зөвхөн a–z, 0–9, _; үсгээр эхэлж 2–40 тэмдэгт.
            </p>
          )}
          <Field label="Нэр" required>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ж: Удаан зогсох"
              disabled={saving}
            />
          </Field>
          <Field label="Ангилал / түвшин">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={saving}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]/30"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Тайлбар">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Юу илрүүлэхийг тайлбарла"
              disabled={saving}
            />
          </Field>
          <Field label="Жин">
            <Input
              type="number"
              step="0.5"
              min="0"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value) || 0)}
              disabled={saving}
            />
          </Field>
          <ModalFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Болих
            </Button>
            <Button type="submit" disabled={saving || !keyValid || !label.trim()}>
              {saving ? "Нэмж байна…" : "Нэмэх"}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

function LevelInput({
  color,
  label,
  hint,
  value,
  onChange,
}: {
  color: string;
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border)] p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-xs text-[var(--color-muted-foreground)]">{hint}</p>
      <div className="mt-2 flex items-center gap-1">
        <span className="text-xs text-[var(--color-muted-foreground)]">
          Босго ≥
        </span>
        <input
          type="number"
          step="0.5"
          min="0"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 font-mono text-sm focus:border-[var(--color-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]/30"
        />
      </div>
    </div>
  );
}
