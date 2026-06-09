import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  Clock,
  ListOrdered,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { Field } from "@/components/Field";
import { behaviors } from "@/lib/api";
import type { BehaviorConfig } from "@/lib/types";

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

/** Super-admin-only editor for the GLOBAL behavior config (weights +
 * 4-level thresholds). The backend PATCH /behaviors is super-admin gated. */
export function BehaviorsPage() {
  const [data, setData] = useState<BehaviorConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [weights, setWeights] = useState<Record<string, number>>({});
  const [greenMax, setGreenMax] = useState<number>(DEF_GREEN);
  const [yellowMax, setYellowMax] = useState<number>(DEF_YELLOW);
  const [highMax, setHighMax] = useState<number>(DEF_HIGH);
  // Global engine knobs + per-detector tuning params (ADR-0024 v2 fine-tuning).
  const [engine, setEngine] = useState<Record<string, number>>({});
  const [paramsByKey, setParamsByKey] = useState<Record<string, Record<string, number>>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function hydrate(j: BehaviorConfig) {
    setData(j);
    setWeights(Object.fromEntries(j.dimensions.map((d) => [d.key, d.weight])));
    setGreenMax(j.thresholds.green_max ?? DEF_GREEN);
    setYellowMax(j.thresholds.yellow_max ?? DEF_YELLOW);
    setHighMax(j.thresholds.high_max ?? DEF_HIGH);
    setEngine({ ...(j.engine ?? {}) });
    setParamsByKey(
      Object.fromEntries(j.dimensions.map((d) => [d.key, { ...(d.params ?? {}) }])),
    );
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

  const dirty = data
    ? data.dimensions.some((d) => weights[d.key] !== d.weight) ||
      greenMax !== (data.thresholds.green_max ?? DEF_GREEN) ||
      yellowMax !== (data.thresholds.yellow_max ?? DEF_YELLOW) ||
      highMax !== (data.thresholds.high_max ?? DEF_HIGH) ||
      numMapsDiffer(engine, data.engine ?? {}) ||
      data.dimensions.some((d) => numMapsDiffer(paramsByKey[d.key] ?? {}, d.params ?? {}))
    : false;

  const thresholdValid =
    greenMax >= 0 && yellowMax > greenMax && highMax > yellowMax;

  async function save() {
    if (!data || !dirty || !thresholdValid) return;
    setSaving(true);
    setErr(null);
    try {
      // 1) Bulk patch: weights + thresholds + engine knobs (one call).
      let fresh = await behaviors.patch({
        weights,
        thresholds: {
          green_max: greenMax,
          yellow_max: yellowMax,
          high_max: highMax,
        },
        engine,
      });
      // 2) Per-detector params changed → one PATCH /dimensions/{key} each.
      for (const d of data.dimensions) {
        if (numMapsDiffer(paramsByKey[d.key] ?? {}, d.params ?? {})) {
          fresh = await behaviors.updateDimension(d.key, {
            params: paramsByKey[d.key] ?? {},
          });
        }
      }
      hydrate(fresh);
      setSavedAt(new Date().toLocaleTimeString("mn-MN"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Хадгалах амжилтгүй");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(key: string, active: boolean) {
    setBusyKey(key);
    setErr(null);
    try {
      hydrate(await behaviors.updateDimension(key, { active }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Шинэчилж чадсангүй");
    } finally {
      setBusyKey(null);
    }
  }

  async function removeDim(key: string) {
    setBusyKey(key);
    setErr(null);
    try {
      hydrate(await behaviors.deleteDimension(key));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Устгаж чадсангүй");
    } finally {
      setBusyKey(null);
    }
  }

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
  const ll = data.level_labels ?? {
    LOW: "Бага",
    MEDIUM: "Дунд",
    HIGH: "Өндөр",
    CRITICAL: "Ноцтой",
  };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Brain className="h-6 w-6 text-[var(--color-primary)]" />
            <h1 className="text-2xl font-semibold">Зан үйлийн engine v2</h1>
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Глобал тохиргоо. AI {detectorCount} / {data.dimensions.length}{" "}
            детектортой шалгуураар 0–100 эрсдэлийн оноо тооцож, дараалал илрэхэд
            нэмэлт оноо өгнө. Жин ↑ = илүү мэдрэмжтэй.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && !dirty && (
            <span className="text-xs text-[var(--color-success)]">
              Хадгалагдсан · {savedAt}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Шалгуур нэмэх
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={!dirty || !thresholdValid || saving}
          >
            <Save className="h-4 w-4" />
            {saving ? "Хадгалж байна..." : "Хадгалах"}
          </Button>
        </div>
      </div>

      {err && <p className="mb-4 text-sm text-[var(--color-danger)]">{err}</p>}

      {/* 4-level thresholds (absolute 0-100) */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            Эрсдэлийн түвшний босго (0–100)
          </CardTitle>
          <CardDescription>
            Хүний нийт оноо энэ босгуудаар 4 түвшинд хуваагдана.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                <span className="text-sm font-medium">
                  {ll.CRITICAL ?? "Ноцтой"}
                </span>
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
        </CardContent>
      </Card>

      {/* Global engine knobs (smooth-frames / decay / sequence window / loiter radius) */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Engine нарийн тохиргоо</CardTitle>
          <CardDescription>
            Глобал параметрүүд — тогтворжилт (давтамж), оноо бууралт, дарааллын
            цонх г.м. Хадгалсны дараа sentry-ai ~30 секундэд хүлээн авна.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {/* Criteria grouped by level */}
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
                    <th className="px-3 py-2 text-left font-medium">Тайлбар</th>
                    <th className="px-3 py-2 text-center font-medium">Детектор</th>
                    <th className="px-3 py-2 text-center font-medium">Идэвх</th>
                    <th className="px-3 py-2 text-right font-medium">Жин</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {dims.map((d) => (
                    <Fragment key={d.key}>
                    <tr
                      className={`border-b border-[var(--color-border)] ${
                        !d.active ? "opacity-60" : ""
                      }`}
                    >
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium">{d.label_mn}</div>
                        <code className="mt-0.5 inline-block rounded bg-[var(--color-muted)] px-1.5 py-0.5 text-xs">
                          {d.key}
                        </code>
                      </td>
                      <td className="max-w-md px-3 py-3 align-top text-xs text-[var(--color-muted-foreground)]">
                        {d.description_mn}
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
                          checked={d.active}
                          disabled={busyKey === d.key}
                          onChange={(e) =>
                            void toggleActive(d.key, e.target.checked)
                          }
                          className="h-4 w-4"
                          aria-label="Идэвхжүүлэх"
                        />
                      </td>
                      <td className="px-3 py-3 align-top text-right">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={weights[d.key] ?? d.weight}
                          onChange={(e) =>
                            setWeights((prev) => ({
                              ...prev,
                              [d.key]: Number(e.target.value) || 0,
                            }))
                          }
                          className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-right font-mono text-sm focus:border-[var(--color-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]/30"
                        />
                      </td>
                      <td className="px-3 py-3 align-top text-center">
                        {!d.builtin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Устгах"
                            disabled={busyKey === d.key}
                            onClick={() => void removeDim(d.key)}
                          >
                            <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                          </Button>
                        )}
                      </td>
                    </tr>
                    {d.has_detector &&
                      Object.keys(paramsByKey[d.key] ?? {}).length > 0 && (
                        <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/40">
                          <td colSpan={6} className="px-3 pb-3 pt-0">
                            <div className="flex flex-wrap items-end gap-3">
                              <span className="pt-4 text-xs text-[var(--color-muted-foreground)]">
                                Нарийн тохиргоо:
                              </span>
                              {Object.keys(paramsByKey[d.key] ?? {})
                                .sort()
                                .map((pk) => (
                                  <label key={pk} className="flex flex-col gap-0.5">
                                    <span className="text-xs text-[var(--color-muted-foreground)]">
                                      {PARAM_LABELS[pk] ?? pk}
                                    </span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={paramsByKey[d.key]?.[pk] ?? ""}
                                      onChange={(e) => {
                                        const val = Number(e.target.value) || 0;
                                        setParamsByKey((prev) => ({
                                          ...prev,
                                          [d.key]: {
                                            ...(prev[d.key] ?? {}),
                                            [pk]: val,
                                          },
                                        }));
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
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}

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

      <p className="mt-6 text-xs text-[var(--color-muted-foreground)]">
        Хадгалсны дараа sentry-ai ~30 секунд дотор шинэ утгуудыг хүлээн авна.
      </p>

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
