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
import { Brain, CheckCircle2, Clock, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Field } from "@/components/Field";
import { behaviors } from "@/lib/api";
import type { BehaviorConfig } from "@/lib/types";

const COLOR_LABEL_FALLBACK = {
  green: "Хэвийн",
  yellow: "Анхаар",
  red: "Сэжигтэй",
};

/** Super-admin-only editor for the GLOBAL behavior config (weights +
 * thresholds). The backend PATCH /behaviors is super-admin gated. */
export function BehaviorsPage() {
  const [data, setData] = useState<BehaviorConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [weights, setWeights] = useState<Record<string, number>>({});
  const [greenMax, setGreenMax] = useState<number>(5);
  const [yellowMax, setYellowMax] = useState<number>(15);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function hydrate(j: BehaviorConfig) {
    setData(j);
    setWeights(Object.fromEntries(j.dimensions.map((d) => [d.key, d.weight])));
    setGreenMax(j.thresholds.green_max ?? 5);
    setYellowMax(j.thresholds.yellow_max ?? 15);
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
      greenMax !== (data.thresholds.green_max ?? 5) ||
      yellowMax !== (data.thresholds.yellow_max ?? 15)
    : false;

  const thresholdValid = greenMax >= 0 && yellowMax > greenMax;

  async function save() {
    if (!dirty || !thresholdValid) return;
    setSaving(true);
    setErr(null);
    try {
      const fresh = await behaviors.patch({
        weights,
        thresholds: { green_max: greenMax, yellow_max: yellowMax },
      });
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

  const activeCount = data.dimensions.filter((d) => d.active_in_m1).length;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Brain className="h-6 w-6 text-[var(--color-primary)]" />
            <h1 className="text-2xl font-semibold">Сэжиг шалгуурууд</h1>
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Глобал тохиргоо. AI {activeCount} / {data.dimensions.length}{" "}
            хэмжээсээр оноо тооцон өнгөт бүсэд хуваана. Жин ↑ = илүү мэдрэмжтэй.
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

      {err && (
        <p className="mb-4 text-sm text-[var(--color-danger)]">{err}</p>
      )}

      {/* Thresholds */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Risk түвшний босго (оноо)</CardTitle>
          <CardDescription>
            Хүний нийт оноо энэ босгуудаас хамаарч өнгө сонгогдоно.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <ThresholdInput
              color="bg-green-500"
              label={data.color_labels?.green ?? COLOR_LABEL_FALLBACK.green}
              hint={`оноо < ${greenMax}`}
              value={greenMax}
              onChange={setGreenMax}
            />
            <ThresholdInput
              color="bg-yellow-500"
              label={data.color_labels?.yellow ?? COLOR_LABEL_FALLBACK.yellow}
              hint={`${greenMax} ≤ оноо < ${yellowMax}`}
              value={yellowMax}
              onChange={setYellowMax}
            />
            <div className="rounded-md border border-[var(--color-border)] p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
                <span className="text-sm font-medium">
                  {data.color_labels?.red ?? COLOR_LABEL_FALLBACK.red}
                </span>
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                оноо ≥ {yellowMax} → автомат clip + alert
              </p>
            </div>
          </div>
          {!thresholdValid && (
            <p className="mt-3 text-xs text-[var(--color-danger)]">
              "Анхаар"-ын босго "Хэвийн"-ийн босгоноос их байх ёстой.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Criteria catalog */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Шалгуурууд</CardTitle>
          <CardDescription>
            Детектортой шалгуур л оноо нэмнэ. Захиалгат шалгуур (детектор
            хүлээгдэж) нь sentry-ai-д код гартал идэвхгүй. Унтраасан шалгуур
            оноо нэмэхгүй.
          </CardDescription>
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
              {data.dimensions.map((d) => (
                <tr
                  key={d.key}
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
                    {d.builtin ? (
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
                      onChange={(e) => void toggleActive(d.key, e.target.checked)}
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
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKey("");
    setLabel("");
    setDescription("");
    setWeight(1);
  }, [open]);

  const keyValid = /^[a-z][a-z0-9_]{1,39}$/.test(key);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyValid || !label.trim()) return;
    setSaving(true);
    try {
      const fresh = await behaviors.addDimension({
        key,
        label_mn: label.trim(),
        description_mn: description.trim(),
        weight,
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
            Анхаар: AI энэ шалгуурыг бодитоор илрүүлэхийн тулд sentry-ai-д
            тухайн түлхүүрийн <strong>детектор код</strong> нэмэгдсэн байх ёстой.
            Тэр болтол шалгуур бүртгэгдэх ч оноо нэмэхгүй.
          </p>
          <Field label="Түлхүүр (key)" required hint="латин жижиг үсэг/тоо/_; үсгээр эхэлнэ">
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
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
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

function ThresholdInput({
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
