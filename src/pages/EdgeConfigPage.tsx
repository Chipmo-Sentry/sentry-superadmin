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
  w_exit_after_conceal: 40.0,
  w_repeated_shelf: 3.0,
  repeated_shelf_threshold: 3,
  interval_holding: 0.0,
  mindur_holding: 0.0,
  interval_wrist_torso: 0.0,
  mindur_wrist_torso: 0.0,
  interval_conceal: 0.0,
  mindur_conceal: 0.0,
  interval_repeated_shelf: 0.0,
  mindur_repeated_shelf: 0.0,
  interval_exit_after_conceal: 0.0,
  mindur_exit_after_conceal: 0.0,
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
  /** Plain-language effect of raising / lowering the value (founder request:
   * "утга нэмэгдвэл яах, хасагдвал яахыг бич"). */
  effect?: string;
}

interface FieldGroup {
  title: string;
  icon: LucideIcon;
  intro?: string;
  fields: EdgeField[];
}

// Grouped so the operator meets the founder's core knobs first ("which movement
// banks how many points"), then the episode thresholds, then the finer geometry.
// Per-behaviour editor (founder): each scoring behaviour has a score + timing
// (interval = bank once per N sec; min-duration = must be active N sec first).
// Rendered as a dedicated table (5 rows × 3 inputs) — these are exactly the
// behaviours shown in the agent-pc «Зан үйл» menu.
interface BehaviorRow {
  label: string;
  desc: string;
  scoreKey: FieldKey;
  intervalKey: FieldKey;
  mindurKey: FieldKey;
  scoreMax: number;
}
const BEHAVIORS: BehaviorRow[] = [
  {
    label: "Эд зүйл барих",
    desc: "Гарт нь бараа ойртож «барьсан» гэж тооцогдох.",
    scoreKey: "w_holding",
    intervalKey: "interval_holding",
    mindurKey: "mindur_holding",
    scoreMax: 50,
  },
  {
    label: "Эд зүйл нуух",
    desc: "Бараа барьсан гар бие рүү ойртвол — нуух байрлал (хамгийн хүчтэй).",
    scoreKey: "w_conceal",
    intervalKey: "interval_conceal",
    mindurKey: "mindur_conceal",
    scoreMax: 50,
  },
  {
    label: "Гар бие рүү",
    desc: "Гар бие рүү ойртсон ч бараа илрээгүй (сул дохио).",
    scoreKey: "w_wrist_torso",
    intervalKey: "interval_wrist_torso",
    mindurKey: "mindur_wrist_torso",
    scoreMax: 50,
  },
  {
    label: "Тавиур давтан зочлох",
    desc: "Нэг тавиурын бүс рүү олон удаа эргэж очих (зон шаардана).",
    scoreKey: "w_repeated_shelf",
    intervalKey: "interval_repeated_shelf",
    mindurKey: "mindur_repeated_shelf",
    scoreMax: 50,
  },
  {
    label: "Нуусны дараа гарц руу",
    desc: "Нуусан хүн гарцын бүс рүү орох — хулгайн хамгийн хүчтэй дохио (зон шаардана).",
    scoreKey: "w_exit_after_conceal",
    intervalKey: "interval_exit_after_conceal",
    mindurKey: "mindur_exit_after_conceal",
    scoreMax: 100,
  },
];

const GROUPS: FieldGroup[] = [
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
        help: "Хүний сэжиг оноо энэ утганд хүрэхэд сэжигтэй эпизод нээгдэнэ (бичлэг эндээс эхэлж бүртгэгдэнэ).",
        effect:
          "↓ багасгавал илүү мэдрэмжтэй (олон бичлэг, cloud зардал ↑); ↑ ихэсгэвэл хатуу (цөөн бичлэг, алдах эрсдэл ↑).",
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
        effect: "↑ ихэсгэвэл эпизод хурдан хаагдана; ↓ багасгавал удаан нээлттэй (бичлэг урт).",
      },
      {
        key: "decay",
        label: "Оноо бууралт",
        unit: "×/кадр",
        kind: "number",
        step: 0.01,
        min: 0.5,
        max: 1,
        help: "Хүн юм хийхгүй үед сэжиг оноо кадр тутам энэ хэмжээгээр буурна.",
        effect: "1-д ойртуулбал сэжиг удаан хадгалагдана; багасгавал хурдан мартана.",
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
        effect: "↑ ихэсгэвэл эпизод удаан нээлттэй; ↓ багасгавал хурдан дуусна.",
      },
      {
        key: "band_yellow",
        label: "Шар туяа (анхаарал)",
        unit: "оноо",
        kind: "number",
        step: 1,
        min: 0,
        max: 100,
        help: "Шууд харах дэлгэц дээр хүний хүрээ ШАР болох оноо (зөвхөн харагдац, илрүүлэлтэд нөлөөлөхгүй).",
        effect: "Зөвхөн дэлгэцийн өнгө — сэрэмжлүүлэгт нөлөөлөхгүй.",
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
        effect: "Зөвхөн дэлгэцийн өнгө — сэрэмжлүүлэгт нөлөөлөхгүй.",
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
        help: "Гар бараанаас энэ зайд (биеийн өндрийн харьцаагаар) ойрвол «барьсан» гэнэ.",
        effect: "↑ ихэсгэвэл хол байсан ч «барьсан» гэнэ (мэдрэмжтэй, худал ↑); ↓ багасгавал зөвхөн ойр.",
      },
      {
        key: "near_frac",
        label: "Нуух радиус",
        unit: "× өндөр",
        kind: "number",
        step: 0.01,
        min: 0.02,
        max: 1,
        help: "Гар бэлхүүс/хармаанд энэ зайд ойрвол «нуух байрлал» гэнэ.",
        effect: "↑ ихэсгэвэл гар бие рүү амар «нуух» гэнэ; ↓ багасгавал зөвхөн ойр.",
      },
      {
        key: "min_kp_conf",
        label: "Цэгийн итгэл",
        unit: "0–1",
        kind: "number",
        step: 0.05,
        min: 0,
        max: 1,
        help: "Биеийн цэг (гар, хип) ийм итгэлтэйгээс дээш байж л тооцно.",
        effect: "↑ ихэсгэвэл зөвхөн тод цэг (чимээ ↓, алдах ↑); ↓ багасгавал бүрхэг цэг ч (чимээ ↑).",
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
        effect: "↑ ихэсгэвэл track тасрах магадлалтай; ↓ багасгавал хүн андуурч нийлэх магадлалтай.",
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
        effect: "↑ ихэсгэвэл алга болсон хүнийг удаан хадгална; ↓ багасгавал хурдан хаяна.",
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
        help: "Хүн гэж тооцох доод итгэл.",
        effect: "↓ багасгавал олон хүн илрүүлнэ (худал ↑); ↑ ихэсгэвэл зөвхөн итгэлтэй (алдах ↑).",
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
        effect: "↓ багасгавал олон бараа илрүүлнэ (худал ↑); ↑ ихэсгэвэл зөвхөн итгэлтэй.",
      },
      {
        key: "frame_skip",
        label: "Кадр алгасалт",
        unit: "кадр тутамд",
        kind: "number",
        step: 1,
        min: 1,
        max: 30,
        help: "YOLO-г N кадр тутамд нэг ажиллуулна.",
        effect: "↑ ихэсгэвэл CPU хэмнэнэ (мэдрэмж ↓); ↓ багасгавал илүү нягт (CPU ↑).",
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
        effect: "↑ ихэсгэвэл бичлэг урт болно; ↓ багасгавал богино.",
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
        effect: "↑ ихэсгэвэл бичлэг урт болно; ↓ багасгавал богино.",
      },
      {
        key: "segment_sec",
        label: "Хэсгийн урт",
        unit: "сек",
        kind: "number",
        step: 0.5,
        min: 0.5,
        max: 10,
        help: "Диск дээр бичигдэх жижиг бичлэг-хэсгийн урт (техникийн).",
        effect: "Ихэвчлэн хэвээр орхино.",
      },
      {
        key: "keep_sec",
        label: "Завсрын хадгалалт",
        unit: "сек",
        kind: "number",
        step: 5,
        min: 10,
        max: 600,
        help: "Эргэлдэх завсрын санах ойд хэдэн секундын бичлэг хадгалах вэ (pre-roll-д хүрэлцэхүйц).",
        effect: "↑ ихэсгэвэл pre-roll-д илүү хүрэлцэнэ (диск ↑); ↓ багасгавал диск хэмнэнэ.",
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
        effect: "↑ ихэсгэвэл олон бичлэг хадгална (диск ↑); ↓ багасгавал хуучин нь эрт устана.",
      },
      {
        key: "max_age_sec",
        label: "Бичлэг хадгалах нас",
        unit: "сек",
        kind: "number",
        step: 3600,
        min: 3600,
        max: 30 * 24 * 3600,
        help: "Бичлэгийг хэдэн секунд хадгалаад устгах вэ (анхдагч 7 хоног).",
        effect: "↑ ихэсгэвэл удаан хадгална; ↓ багасгавал хурдан устгана.",
      },
      {
        key: "upload_clips",
        label: "Cloud руу илгээх",
        kind: "bool",
        help: "Сэжигтэй бичлэгийг cloud VLM руу баталгаажуулахаар илгээх эсэх.",
        effect: "Унтраавал бичлэг зөвхөн локалд үлдэж, cloud руу илгээхгүй.",
      },
    ],
  },
];

// Every editable key: the generic groups + the per-behaviour table (score +
// timing) + the shelf-revisit threshold (which lives under the behaviour table).
const ALL_KEYS: FieldKey[] = [
  ...GROUPS.flatMap((g) => g.fields.map((f) => f.key)),
  ...BEHAVIORS.flatMap((b) => [b.scoreKey, b.intervalKey, b.mindurKey]),
  "repeated_shelf_threshold",
];

/** Per-store editor for the agent-pc Stage-1 behaviour engine. Pick a store →
 * tune the 24 edge tunables. Only fields differing from the agent DEFAULTS are
 * saved as per-store overrides (PUT bumps the version → store agents re-apply
 * within ~one poll). Defaults are shown next to every field so the operator
 * sees exactly what they're changing from. Super-admin gated end-to-end. */
export function EdgeConfigPage() {
  const [view, setView] = useState<EdgeConfigAdminView | null>(null);
  const [draft, setDraft] = useState<Record<string, number | boolean>>({});
  const [loadingCfg, setLoadingCfg] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Load the ONE global edge config on mount + seed the draft from its effective
  // values (the config is platform-wide now — no store to choose).
  useEffect(() => {
    let cancelled = false;
    setLoadingCfg(true);
    admin.getGlobalEdgeConfig().then(
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
  }, []);

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
    if (!dirty || saving) return;
    setSaving(true);
    setErr(null);
    // Only ship the keys that differ from the agent default → the rest reset.
    const overrides: Record<string, number | boolean> = {};
    for (const k of ALL_KEYS) {
      if (draft[k] !== undefined && draft[k] !== DEFAULTS[k]) overrides[k] = draft[k];
    }
    try {
      const fresh = await admin.setGlobalEdgeConfig(overrides as EdgeConfigOverrides);
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
      <div className="mb-5">
        <div className="mb-2 flex items-center gap-2">
          <MonitorCog className="h-6 w-6 text-[var(--color-primary)]" />
          <h1 className="text-2xl font-semibold">Edge тохиргоо — дэлгүүрийн AI хөдөлгүүр</h1>
        </div>
        <p className="max-w-3xl text-sm text-[var(--color-muted-foreground)]">
          Дэлгүүрийн компьютер (agent-pc) дээр ажилладаг <strong>Stage-1 зан үйлийн
          хөдөлгүүр</strong>ийн тохиргоо: ямар хөдөлгөөнд хэдэн оноо нэмэгдэх, хэдэн
          оноонд сэжигтэй бичлэг үүсэхийг тодорхойлно. (Cloud дахь «Сэжиг шалгуур»
          хөдөлгүүрээс тусдаа.)
        </p>
      </div>

      {/* «Global, all stores» callout — replaces the old store picker. */}
      <div className="mb-5 flex items-start gap-3 rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-4 py-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-primary)]" />
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Энэ тохиргоо нь <strong className="text-[var(--color-foreground)]">бүх дэлгүүрийн
          бүх камерт нэг ижил</strong> үйлчилнэ. Хадгалмагц бүх агент ~1 минутын дотор
          шинэ утгыг автоматаар авна.
        </p>
      </div>

      {err && <p className="mb-4 text-sm text-[var(--color-danger)]">{err}</p>}

      {loadingCfg && (
        <div className="p-8">
          <Spinner />
        </div>
      )}

      {view && !loadingCfg && (
        <>
          {/* Status bar */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-4 py-3 text-sm">
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
                "Бүх утга анхдагч (өөрчлөлт алга)"
              ) : (
                <Badge tone="warning">{overrideCount} өөрчлөлт</Badge>
              )}
            </span>
          </div>

          <BehaviorTable
            draft={draft}
            disabled={saving}
            onChange={setField}
            onReset={resetField}
          />

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

const NUM_INPUT_CLASS =
  "w-20 rounded-md border bg-[var(--color-background)] px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]/30";

/** A single numeric cell bound to draft[key]; highlights when overridden. */
function NumCell({
  fkey,
  draft,
  disabled,
  onChange,
  step,
  min,
  max,
}: {
  fkey: FieldKey;
  draft: Record<string, number | boolean>;
  disabled: boolean;
  onChange: (key: FieldKey, value: number) => void;
  step: number;
  min: number;
  max: number;
}) {
  const cur = draft[fkey];
  const overridden = cur !== undefined && cur !== DEFAULTS[fkey];
  return (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      value={cur === undefined ? "" : Number(cur)}
      disabled={disabled}
      onChange={(e) => onChange(fkey, e.target.value === "" ? 0 : Number(e.target.value))}
      className={`${NUM_INPUT_CLASS} ${
        overridden ? "border-[var(--color-warning)]" : "border-[var(--color-border)]"
      }`}
    />
  );
}

/** The founder's per-behaviour editor: score + timing (interval + min-duration)
 * for each of the 5 scoring behaviours, in one table — mirroring agent-pc «Зан
 * үйл». The shelf-revisit count threshold sits just under it. */
function BehaviorTable({
  draft,
  disabled,
  onChange,
  onReset,
}: {
  draft: Record<string, number | boolean>;
  disabled: boolean;
  onChange: (key: FieldKey, value: number | boolean) => void;
  onReset: (key: FieldKey) => void;
}) {
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-[var(--color-primary)]" />
          Зан үйл — оноо ба хугацаа
        </CardTitle>
        <CardDescription className="mt-1">
          agent-pc «Зан үйл» цэсэнд харагдах яг тэр зан үйлүүд. Тус бүрд:{" "}
          <strong>Оноо</strong> — илрэхэд сэжиг оноонд хэдэн оноо нэмэх;{" "}
          <strong>Давтамж</strong> — хэдэн секунд тутамд НЭГ л банклах (0 = кадр бүрд);{" "}
          <strong>Үргэлжлэх</strong> — хэдэн секунд тогтвортой үргэлжилж байж банклаж эхлэх.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted)] text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Зан үйл</th>
                <th className="px-3 py-2 text-right font-medium">Оноо</th>
                <th className="px-3 py-2 text-right font-medium">Давтамж (сек)</th>
                <th className="px-3 py-2 text-right font-medium">Үргэлжлэх (сек)</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {BEHAVIORS.map((b) => {
                const dirtyRow = [b.scoreKey, b.intervalKey, b.mindurKey].some(
                  (k) => draft[k] !== undefined && draft[k] !== DEFAULTS[k],
                );
                return (
                  <tr key={b.scoreKey} className="border-t border-[var(--color-border)] align-top">
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{b.label}</div>
                      <p className="mt-0.5 max-w-md text-xs leading-relaxed text-[var(--color-muted-foreground)]">
                        {b.desc}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <NumCell fkey={b.scoreKey} draft={draft} disabled={disabled}
                        onChange={onChange} step={0.5} min={0} max={b.scoreMax} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <NumCell fkey={b.intervalKey} draft={draft} disabled={disabled}
                        onChange={onChange} step={0.5} min={0} max={60} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <NumCell fkey={b.mindurKey} draft={draft} disabled={disabled}
                        onChange={onChange} step={0.5} min={0} max={60} />
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          onReset(b.scoreKey);
                          onReset(b.intervalKey);
                          onReset(b.mindurKey);
                        }}
                        disabled={disabled || !dirtyRow}
                        title="Энэ мөрийг анхдагч руу буцаах"
                        className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-30"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Shelf-revisit count threshold (belongs with «Тавиур давтан зочлох»). */}
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span className="text-[var(--color-muted-foreground)]">
            «Тавиур давтан зочлох» босго — хэдэн удаа очвол тооцох:
          </span>
          <NumCell fkey="repeated_shelf_threshold" draft={draft} disabled={disabled}
            onChange={onChange} step={1} min={2} max={20} />
        </div>
      </CardContent>
    </Card>
  );
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
                        {f.effect && (
                          <p className="mt-1 text-xs leading-relaxed text-[var(--color-primary)] sm:hidden">
                            {f.effect}
                          </p>
                        )}
                      </td>
                      <td className="hidden max-w-md px-3 py-2.5 text-xs leading-relaxed text-[var(--color-muted-foreground)] sm:table-cell">
                        {f.help}
                        {f.effect && (
                          <span className="mt-1 block text-[var(--color-primary)]">
                            {f.effect}
                          </span>
                        )}
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
