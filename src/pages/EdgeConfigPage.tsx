import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@chipmo-sentry/ui-kit";
import {
  Camera,
  HardDriveDownload,
  Info,
  MonitorCog,
  RotateCcw,
  Save,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";

import { admin } from "@/lib/api";
import type {
  EdgeConfigAdminView,
  EdgeConfigOverrides,
  EdgeConfigPayload,
  StoreAdminRow,
} from "@/lib/api";

// Agent defaults — MUST mirror sentry-backend schemas/edge.py EdgeConfigPayload
// (and sentry_agent_pc.edge.config.EdgeConfig). A field equal to its default is
// NOT stored as an override; differing from it = an explicit per-store override.
const DEFAULTS: Record<FieldKey, number | boolean> = {
  person_conf: 0.35,
  item_conf: 0.4,
  frame_skip: 3,
  w_holding: 5.0,
  w_conceal: 14.0,
  w_wrist_torso: 3.0,
  reach_frac: 0.35,
  near_frac: 0.18,
  min_kp_conf: 0.3,
  decay: 0.9,
  open_risk: 60.0,
  close_risk: 30.0,
  post_quiet_sec: 2.0,
  drop_after_sec: 1.5,
  iou_match: 0.3,
  band_yellow: 40.0,
  band_red: 70.0,
  pre_sec: 3.0,
  post_sec: 3.0,
  segment_sec: 1.0,
  keep_sec: 45.0,
  max_clips: 50,
  max_age_sec: 7 * 24 * 3600,
  upload_clips: true,
};

type FieldKey = keyof EdgeConfigOverrides;

interface EdgeField {
  key: FieldKey;
  label: string;
  help: string;
  kind: "number" | "bool";
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
}

interface FieldGroup {
  title: string;
  icon: LucideIcon;
  intro?: string;
  fields: EdgeField[];
}

// Grouped so the operator meets the founder's core knobs first ("which movement
// banks how many points"), then the episode thresholds, then the finer geometry.
const GROUPS: FieldGroup[] = [
  {
    title: "Зан үйлийн оноо (жин)",
    icon: ShieldAlert,
    intro:
      "Энэ дэлгүүрийн камер дээр хүн дараах хөдөлгөөн хийх бүрд суспиц оноонд хэдэн оноо НЭМЭГДЭХ вэ. Их = илүү мэдрэмжтэй (бага хөдөлгөөнд ч сэжиг үүснэ).",
    fields: [
      {
        key: "w_holding",
        label: "Эд зүйл барих",
        unit: "оноо",
        kind: "number",
        step: 0.5,
        min: 0,
        max: 50,
        help: "Гарт нь бараа ойртож «барьсан» гэж тооцогдох кадр бүрд нэмэгдэх оноо.",
      },
      {
        key: "w_conceal",
        label: "Эд зүйл нуух (бараа + бие рүү)",
        unit: "оноо",
        kind: "number",
        step: 0.5,
        min: 0,
        max: 50,
        help: "Бараа барьсан гар нь бэлхүүс/хармаан руу ойртвол (нуух поз) нэмэгдэх оноо. Хамгийн хүчтэй дохио.",
      },
      {
        key: "w_wrist_torso",
        label: "Гар бие рүү (бараагүй)",
        unit: "оноо",
        kind: "number",
        step: 0.5,
        min: 0,
        max: 50,
        help: "Гар бие рүү ойртсон ч бараа илрээгүй үед нэмэгдэх бага оноо.",
      },
    ],
  },
  {
    title: "Эрсдэл → сэжигтэй бичлэг (эпизод)",
    icon: MonitorCog,
    intro:
      "Цугларсан оноо хэдэд хүрвэл «сэжигтэй эпизод» нээгдэж, бичлэг (clip) хадгалагдаж cloud руу илгээгдэхийг тодорхойлно.",
    fields: [
      {
        key: "open_risk",
        label: "Эпизод нээх босго",
        unit: "оноо",
        kind: "number",
        step: 1,
        min: 0,
        max: 100,
        help: "Хүний суспиц оноо энэ утганд хүрэхэд сэжигтэй эпизод нээгдэнэ (бичлэг эндээс эхэлж бүртгэгдэнэ). Бууруулбал илүү мэдрэмжтэй.",
      },
      {
        key: "close_risk",
        label: "Эпизод хаах босго",
        unit: "оноо",
        kind: "number",
        step: 1,
        min: 0,
        max: 100,
        help: "Оноо энэ утганаас доош унаад намжвал эпизод хаагдаж бичлэг бүрэн болно.",
      },
      {
        key: "decay",
        label: "Оноо бууралт",
        unit: "×/кадр",
        kind: "number",
        step: 0.01,
        min: 0.5,
        max: 1,
        help: "Хүн юм хийхгүй үед оноо кадр тутам энэ коэффициентээр буурна. 1-д ойр = удаан мартана.",
      },
      {
        key: "post_quiet_sec",
        label: "Намжих хугацаа",
        unit: "сек",
        kind: "number",
        step: 0.5,
        min: 0,
        max: 30,
        help: "Эпизодыг хаахаас өмнө хэдэн секунд тайван байх ёстой вэ.",
      },
      {
        key: "band_yellow",
        label: "Шар туяа (анхаарал)",
        unit: "оноо",
        kind: "number",
        step: 1,
        min: 0,
        max: 100,
        help: "Шууд харах дэлгэц дээр хүний хүрээ ШАР болох оноо (зөвхөн харагдац).",
      },
      {
        key: "band_red",
        label: "Улаан туяа (өндөр)",
        unit: "оноо",
        kind: "number",
        step: 1,
        min: 0,
        max: 100,
        help: "Шууд харах дэлгэц дээр хүний хүрээ УЛААН болох оноо (зөвхөн харагдац).",
      },
    ],
  },
  {
    title: "Геометр ба мэдрэмж",
    icon: MonitorCog,
    intro:
      "Хөдөлгөөнийг хэр ойроос «барих/нуух» гэж тооцох, track-ийг хэр удаан хадгалах нарийн тохиргоо. Ихэвчлэн анхдагчаар орхино.",
    fields: [
      {
        key: "reach_frac",
        label: "Барих радиус",
        unit: "× өндөр",
        kind: "number",
        step: 0.01,
        min: 0.05,
        max: 1,
        help: "Гар бараанаас энэ зайд (биеийн өндрийн харьцаагаар) ойрвол «барьсан» гэнэ. Их = илүү амар барьсан гэнэ.",
      },
      {
        key: "near_frac",
        label: "Нуух радиус",
        unit: "× өндөр",
        kind: "number",
        step: 0.01,
        min: 0.02,
        max: 1,
        help: "Гар бэлхүүс/хармаанд энэ зайд ойрвол «нуух поз» гэнэ.",
      },
      {
        key: "min_kp_conf",
        label: "Цэгийн итгэл",
        unit: "0–1",
        kind: "number",
        step: 0.05,
        min: 0,
        max: 1,
        help: "Биеийн цэг (гар, хип) ийм итгэлтэйгээс дээш байж л тооцно. Бага = чимээ шуугиан ↑.",
      },
      {
        key: "iou_match",
        label: "Track тааруулалт (IoU)",
        unit: "0–1",
        kind: "number",
        step: 0.05,
        min: 0,
        max: 1,
        help: "Дараалсан кадруудад нэг хүнийг таних давхцлын босго.",
      },
      {
        key: "drop_after_sec",
        label: "Track хаях",
        unit: "сек",
        kind: "number",
        step: 0.5,
        min: 0,
        max: 30,
        help: "Хүн харагдахаа болиод хэдэн секундын дараа track-ийг хаях вэ.",
      },
    ],
  },
  {
    title: "Илрүүлэлт (YOLO)",
    icon: Camera,
    fields: [
      {
        key: "person_conf",
        label: "Хүн илрүүлэх итгэл",
        unit: "0–1",
        kind: "number",
        step: 0.05,
        min: 0,
        max: 1,
        help: "Хүн гэж тооцох доод итгэл. Бага = олон илрүүлнэ (худал илрүүлэлт ↑).",
      },
      {
        key: "item_conf",
        label: "Бараа илрүүлэх итгэл",
        unit: "0–1",
        kind: "number",
        step: 0.05,
        min: 0,
        max: 1,
        help: "Бараа гэж тооцох доод итгэл.",
      },
      {
        key: "frame_skip",
        label: "Кадр алгасалт",
        unit: "кадр тутамд",
        kind: "number",
        step: 1,
        min: 1,
        max: 30,
        help: "YOLO-г N кадр тутамд нэг ажиллуулна. Их = CPU хэмнэнэ (мэдрэмж ↓).",
      },
    ],
  },
  {
    title: "Бичлэг ба cloud руу илгээх",
    icon: HardDriveDownload,
    fields: [
      {
        key: "pre_sec",
        label: "Өмнөх (pre-roll)",
        unit: "сек",
        kind: "number",
        step: 0.5,
        min: 0,
        max: 30,
        help: "Үйлдэл эхлэхээс хэдэн секундын ӨМНӨХ бичлэгийг хадгалах вэ.",
      },
      {
        key: "post_sec",
        label: "Дараах (post-roll)",
        unit: "сек",
        kind: "number",
        step: 0.5,
        min: 0,
        max: 30,
        help: "Үйлдэл дуусахаас хэдэн секундын ДАРААХ бичлэгийг хадгалах вэ.",
      },
      {
        key: "segment_sec",
        label: "Сегмент урт",
        unit: "сек",
        kind: "number",
        step: 0.5,
        min: 0.5,
        max: 10,
        help: "Диск дээр бичигдэх жижиг сегментийн урт.",
      },
      {
        key: "keep_sec",
        label: "Буфер хадгалах",
        unit: "сек",
        kind: "number",
        step: 5,
        min: 10,
        max: 600,
        help: "Эргэлдэх буферт хэдэн секундын сегмент хадгалах вэ (pre-roll-д хүрэлцэхүйц).",
      },
      {
        key: "max_clips",
        label: "Бичлэгийн дээд тоо",
        unit: "ширхэг",
        kind: "number",
        step: 1,
        min: 1,
        max: 1000,
        help: "Дэлгүүрийн PC дээр хадгалах сэжигтэй бичлэгийн дээд тоо.",
      },
      {
        key: "max_age_sec",
        label: "Бичлэг хадгалах нас",
        unit: "сек",
        kind: "number",
        step: 3600,
        min: 3600,
        max: 30 * 24 * 3600,
        help: "Бичлэгийг хэдэн секунд хадгалаад устгах вэ (default 7 хоног).",
      },
      {
        key: "upload_clips",
        label: "Cloud руу илгээх",
        kind: "bool",
        help: "Сэжигтэй бичлэгийг cloud VLM руу баталгаажуулахаар илгээх эсэх.",
      },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

/** Per-store editor for the agent-pc Stage-1 behaviour engine. Pick a store →
 * tune the 24 edge tunables. Only fields differing from the agent DEFAULTS are
 * saved as per-store overrides (PUT bumps the version → store agents re-apply
 * within ~one poll). Defaults are shown next to every field so the operator
 * sees exactly what they're changing from. Super-admin gated end-to-end. */
export function EdgeConfigPage() {
  const [stores, setStores] = useState<StoreAdminRow[] | null>(null);
  const [storeId, setStoreId] = useState<string>("");
  const [view, setView] = useState<EdgeConfigAdminView | null>(null);
  const [draft, setDraft] = useState<Record<string, number | boolean>>({});
  const [loadingCfg, setLoadingCfg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Load the store list once.
  useEffect(() => {
    let cancelled = false;
    admin.listStores().then(
      (s) => !cancelled && setStores(s),
      (e) => !cancelled && setErr(e instanceof Error ? e.message : "Алдаа"),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the selected store's config + seed the draft from its effective values.
  useEffect(() => {
    if (!storeId) {
      setView(null);
      setDraft({});
      return;
    }
    let cancelled = false;
    setLoadingCfg(true);
    setErr(null);
    setSavedAt(null);
    admin.getStoreEdgeConfig(storeId).then(
      (v) => {
        if (cancelled) return;
        setView(v);
        setDraft(seedDraft(v.effective));
        setLoadingCfg(false);
      },
      (e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "Тохиргоо ачаалж чадсангүй");
        setLoadingCfg(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const storesByOrg = useMemo(() => {
    const m = new Map<string, StoreAdminRow[]>();
    for (const s of stores ?? []) {
      const list = m.get(s.organization_name) ?? [];
      list.push(s);
      m.set(s.organization_name, list);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [stores]);

  const overrideCount = useMemo(
    () => ALL_KEYS.filter((k) => draft[k] !== undefined && draft[k] !== DEFAULTS[k]).length,
    [draft],
  );

  const dirty = useMemo(() => {
    if (!view) return false;
    const eff = seedDraft(view.effective);
    return ALL_KEYS.some((k) => draft[k] !== eff[k]);
  }, [draft, view]);

  function setField(key: FieldKey, value: number | boolean) {
    setDraft((p) => ({ ...p, [key]: value }));
  }

  function resetField(key: FieldKey) {
    setDraft((p) => ({ ...p, [key]: DEFAULTS[key] }));
  }

  function resetAll() {
    const d: Record<string, number | boolean> = {};
    for (const k of ALL_KEYS) d[k] = DEFAULTS[k];
    setDraft(d);
  }

  function revert() {
    if (view) setDraft(seedDraft(view.effective));
  }

  async function save() {
    if (!storeId || !dirty || saving) return;
    setSaving(true);
    setErr(null);
    // Only ship the keys that differ from the agent default → the rest reset.
    const overrides: Record<string, number | boolean> = {};
    for (const k of ALL_KEYS) {
      if (draft[k] !== undefined && draft[k] !== DEFAULTS[k]) overrides[k] = draft[k];
    }
    try {
      const fresh = await admin.setStoreEdgeConfig(storeId, overrides as EdgeConfigOverrides);
      setView(fresh);
      setDraft(seedDraft(fresh.effective));
      setSavedAt(new Date().toLocaleTimeString("mn-MN"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Хадгалах амжилтгүй");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <MonitorCog className="h-6 w-6 text-[var(--color-primary)]" />
          <h1 className="text-2xl font-semibold">Edge тохиргоо — дэлгүүрийн AI хөдөлгүүр</h1>
        </div>
        <p className="max-w-3xl text-sm text-[var(--color-muted-foreground)]">
          Дэлгүүрийн компьютер (agent-pc) дээр ажилладаг <strong>Stage-1 зан үйлийн
          хөдөлгүүр</strong>ийн тохиргоо. Энд ямар хөдөлгөөнд хэдэн оноо нэмэгдэх,
          хэдэн оноонд сэжигтэй бичлэг үүсэхийг <strong>дэлгүүр тус бүрээр</strong>
          тааруулна. Хадгалмагц тухайн дэлгүүрийн агентууд ~1 polling дотор шинэ
          тохиргоог авна. (Энэ нь cloud дахь «Сэжиг шалгуур» хөдөлгүүрээс тусдаа.)
        </p>
      </div>

      {/* Store picker */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Дэлгүүр сонгох</CardTitle>
          <CardDescription>
            Тохиргоо нь сонгосон дэлгүүрийн бүх камерт хамаарна.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stores === null ? (
            <Spinner />
          ) : stores.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Дэлгүүр алга байна.
            </p>
          ) : (
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="w-full max-w-md rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]/30"
            >
              <option value="">— Дэлгүүр сонгоно уу —</option>
              {storesByOrg.map(([org, list]) => (
                <optgroup key={org} label={org}>
                  {list.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.camera_count} камер)
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {err && <p className="mb-4 text-sm text-[var(--color-danger)]">{err}</p>}

      {storeId && loadingCfg && (
        <div className="p-8">
          <Spinner />
        </div>
      )}

      {storeId && view && !loadingCfg && (
        <>
          {/* Status bar */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-4 py-3 text-sm">
            <Info className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
            <span className="text-[var(--color-muted-foreground)]">
              Хувилбар <strong className="text-[var(--color-foreground)]">v{view.version}</strong>
            </span>
            {view.updated_at && (
              <span className="text-[var(--color-muted-foreground)]">
                · Шинэчлэгдсэн {new Date(view.updated_at).toLocaleString("mn-MN")}
              </span>
            )}
            <span className="text-[var(--color-muted-foreground)]">
              ·{" "}
              {overrideCount === 0 ? (
                "Бүх утга анхдагч (override алга)"
              ) : (
                <Badge tone="warning">{overrideCount} өөрчлөлт</Badge>
              )}
            </span>
          </div>

          {GROUPS.map((group) => (
            <ConfigGroup
              key={group.title}
              group={group}
              draft={draft}
              disabled={saving}
              onChange={setField}
              onReset={resetField}
            />
          ))}

          {/* Save / revert / reset-all bar */}
          <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-3 border-t border-[var(--color-border)] bg-[var(--color-background)]/95 py-4 backdrop-blur">
            {savedAt && !dirty && (
              <span className="mr-auto text-xs text-[var(--color-success)]">
                ✓ Хадгалагдсан · {savedAt}
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={resetAll}
              disabled={saving || overrideCount === 0}
              title="Бүх утгыг анхдагч руу буцаах"
            >
              <RotateCcw className="h-4 w-4" />
              Бүгдийг анхдагчаар
            </Button>
            {dirty && (
              <Button size="sm" variant="ghost" onClick={revert} disabled={saving}>
                Болих
              </Button>
            )}
            <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
              <Save className="h-4 w-4" />
              {saving ? "Хадгалж байна..." : "Хадгалах"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Seed an editable draft from the effective merged config (only our known keys). */
function seedDraft(eff: EdgeConfigPayload): Record<string, number | boolean> {
  const d: Record<string, number | boolean> = {};
  for (const k of ALL_KEYS) d[k] = eff[k as keyof EdgeConfigPayload];
  return d;
}

/** One grouped table of tunables with default-vs-current + per-field reset. */
function ConfigGroup({
  group,
  draft,
  disabled,
  onChange,
  onReset,
}: {
  group: FieldGroup;
  draft: Record<string, number | boolean>;
  disabled: boolean;
  onChange: (key: FieldKey, value: number | boolean) => void;
  onReset: (key: FieldKey) => void;
}) {
  const Icon = group.icon;
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-[var(--color-primary)]" />
          {group.title}
        </CardTitle>
        {group.intro && <CardDescription className="mt-1">{group.intro}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted)] text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Тохиргоо</th>
                <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">
                  Тайлбар
                </th>
                <th className="px-3 py-2 text-right font-medium">Анхдагч</th>
                <th className="px-3 py-2 text-right font-medium">Утга</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {group.fields.map((f) => {
                const cur = draft[f.key];
                const def = DEFAULTS[f.key];
                const overridden = cur !== undefined && cur !== def;
                return (
                  <Fragment key={f.key}>
                    <tr className="border-t border-[var(--color-border)] align-top">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 font-medium">
                          {f.label}
                          {overridden && <Badge tone="warning">өөрчилсөн</Badge>}
                        </div>
                        {f.unit && (
                          <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                            {f.unit}
                          </div>
                        )}
                        <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted-foreground)] sm:hidden">
                          {f.help}
                        </p>
                      </td>
                      <td className="hidden max-w-md px-3 py-2.5 text-xs leading-relaxed text-[var(--color-muted-foreground)] sm:table-cell">
                        {f.help}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-[var(--color-muted-foreground)]">
                        {f.kind === "bool" ? (def ? "Тийм" : "Үгүй") : String(def)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {f.kind === "bool" ? (
                          <input
                            type="checkbox"
                            checked={cur === true}
                            disabled={disabled}
                            onChange={(e) => onChange(f.key, e.target.checked)}
                            className="h-4 w-4"
                          />
                        ) : (
                          <input
                            type="number"
                            step={f.step}
                            min={f.min}
                            max={f.max}
                            value={cur === undefined ? "" : Number(cur)}
                            disabled={disabled}
                            onChange={(e) =>
                              onChange(f.key, e.target.value === "" ? 0 : Number(e.target.value))
                            }
                            className={`w-24 rounded-md border bg-[var(--color-background)] px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]/30 ${
                              overridden
                                ? "border-[var(--color-warning)]"
                                : "border-[var(--color-border)] focus:border-[var(--color-ring)]"
                            }`}
                          />
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onReset(f.key)}
                          disabled={disabled || !overridden}
                          title="Анхдагч руу буцаах"
                          className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-30"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
