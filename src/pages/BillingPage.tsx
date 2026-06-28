/** Super-admin billing console (T14).
 *
 * - KPI cards from GET /admin/billing/overview (+ today's usage from analytics)
 * - Daily money-flow bar chart from GET /admin/billing/analytics?range=
 * - Per-org table; clicking a row opens a detail modal with the journal
 *   history (paged), a top-up form and an emergency-credit form
 * - Promo-code section with a create modal and activate/deactivate toggle
 */
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Toast,
  ToastDescription,
  ToastProvider,
  ToastViewport,
} from "@chipmo-sentry/ui-kit";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  Plus,
  Ticket,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { billing } from "@/lib/api";
import type {
  BillingAnalytics,
  BillingOverview,
  BillingStatus,
  JournalEntryPublic,
  JournalKind,
  LedgerAccount,
  OrgBillingRow,
  PromoCodePublic,
  PromoKind,
} from "@/lib/types";

// --- labels / formatting -----------------------------------------------------

const STATUS_LABEL: Record<BillingStatus, string> = {
  active: "Идэвхтэй",
  credit: "Зээлтэй",
  suspended: "Хаагдсан",
};
const STATUS_TONE: Record<BillingStatus, "success" | "warning" | "danger"> = {
  active: "success",
  credit: "warning",
  suspended: "danger",
};

const KIND_LABEL: Record<JournalKind, string> = {
  topup: "Цэнэглэлт",
  usage_charge: "Ашиглалтын төлбөр",
  promo_credit: "Промо кредит",
  adjustment: "Залруулга",
};

const ACCOUNT_LABEL: Record<LedgerAccount, string> = {
  cash: "Касс",
  org_wallet: "Хэрэглэгчийн данс",
  revenue: "Орлого",
  promo_expense: "Промо зардал",
};

const PROMO_KIND_LABEL: Record<PromoKind, string> = {
  bonus_amount: "Дүнгийн кредит",
  free_days: "Үнэгүй өдөр",
};

function mnt(n: number): string {
  return `${n.toLocaleString("mn-MN")}₮`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("mn-MN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("mn-MN");
}

/** Format a Date as a `<input type="datetime-local">` value (LOCAL time,
 * "YYYY-MM-DDTHH:mm"). On submit `new Date(value)` reads it back as local and
 * `.toISOString()` converts to UTC — so the round-trip stays consistent. */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// --- tiny local toast ----------------------------------------------------------

type ToastMsg = { id: number; tone: "success" | "danger"; text: string };

function useToasts() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const push = useCallback((tone: "success" | "danger", text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
  }, []);
  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);
  return { toasts, push, remove };
}

// --- revenue chart -------------------------------------------------------------

const SERIES: { key: "usage_mnt" | "topup_mnt" | "promo_mnt"; label: string; color: string }[] = [
  { key: "topup_mnt", label: "Цэнэглэлт", color: "#22c55e" },
  { key: "usage_mnt", label: "Ашиглалт", color: "#3b82f6" },
  { key: "promo_mnt", label: "Промо", color: "#a855f7" },
];

function RevenueChart({
  data,
  range,
  onRange,
}: {
  data: BillingAnalytics | null;
  range: string;
  onRange: (r: string) => void;
}) {
  const ranges = [
    { k: "7d", l: "7 хон" },
    { k: "30d", l: "30 хон" },
    { k: "90d", l: "90 хон" },
  ];
  const points = data?.by_day ?? [];
  const max =
    points.reduce(
      (m, p) => Math.max(m, p.usage_mnt, p.topup_mnt, p.promo_mnt),
      0,
    ) || 1;

  const W = 720;
  const H = 140;
  const PAD_B = 16;
  const plotH = H - PAD_B;
  const groupW = points.length > 0 ? W / points.length : W;
  const barW = Math.max(1.5, Math.min(8, (groupW - 4) / 3));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Мөнгөн урсгал (өдрөөр)</CardTitle>
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r.k}
              onClick={() => onRange(r.k)}
              className={`rounded px-2 py-0.5 text-xs ${
                range === r.k
                  ? "bg-(--color-primary) text-white"
                  : "text-(--color-muted-foreground) hover:bg-(--color-muted)"
              }`}
            >
              {r.l}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {data === null ? (
          <Spinner />
        ) : points.length === 0 ? (
          <p className="text-sm text-(--color-muted-foreground)">
            Энэ хугацаанд гүйлгээ бүртгэгдээгүй.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-4 text-xs">
              {SERIES.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.label}:{" "}
                  <span className="font-medium tabular-nums">
                    {mnt(data.totals[s.key])}
                  </span>
                </span>
              ))}
            </div>
            <svg
              width="100%"
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
            >
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <line
                  key={f}
                  x1={0}
                  y1={plotH - f * plotH}
                  x2={W}
                  y2={plotH - f * plotH}
                  stroke="var(--color-border)"
                  strokeWidth={0.5}
                  strokeOpacity={0.45}
                />
              ))}
              <line
                x1={0}
                y1={plotH}
                x2={W}
                y2={plotH}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
              {points.map((p, i) => {
                const gx = i * groupW + (groupW - barW * 3) / 2;
                return (
                  <g key={p.day}>
                    {SERIES.map((s, j) => {
                      const v = p[s.key];
                      const h = (v / max) * (plotH - 4);
                      return (
                        <rect
                          key={s.key}
                          x={gx + j * barW}
                          y={plotH - h}
                          width={Math.max(barW - 0.5, 1)}
                          height={Math.max(h, v > 0 ? 1 : 0)}
                          fill={s.color}
                        >
                          <title>{`${p.day} · ${s.label}: ${mnt(v)}`}</title>
                        </rect>
                      );
                    })}
                  </g>
                );
              })}
              {points.length > 0 && (
                <>
                  <text
                    x={2}
                    y={H - 3}
                    fontSize={9}
                    fill="var(--color-muted-foreground)"
                  >
                    {points[0]?.day}
                  </text>
                  <text
                    x={W - 2}
                    y={H - 3}
                    fontSize={9}
                    textAnchor="end"
                    fill="var(--color-muted-foreground)"
                  >
                    {points[points.length - 1]?.day}
                  </text>
                </>
              )}
            </svg>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- org detail modal ------------------------------------------------------------

const JOURNAL_PAGE = 50;

function OrgBillingModal({
  org,
  onClose,
  onChanged,
  notify,
}: {
  org: OrgBillingRow;
  onClose: () => void;
  onChanged: () => void;
  notify: (tone: "success" | "danger", text: string) => void;
}) {
  const [entries, setEntries] = useState<JournalEntryPublic[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  const [topupAmount, setTopupAmount] = useState("");
  const [topupNote, setTopupNote] = useState("");
  const [topupSaving, setTopupSaving] = useState(false);

  const [creditUntil, setCreditUntil] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [creditSaving, setCreditSaving] = useState(false);

  const loadJournal = useCallback(
    async (offset: number) => {
      const batch = await billing.journal(org.org_id, JOURNAL_PAGE, offset);
      setEntries((prev) => [...(offset === 0 ? [] : (prev ?? [])), ...batch]);
      setHasMore(batch.length === JOURNAL_PAGE);
    },
    [org.org_id],
  );

  useEffect(() => {
    setEntries(null);
    setJournalError(null);
    loadJournal(0).catch((e) =>
      setJournalError(e instanceof Error ? e.message : "Алдаа"),
    );
  }, [loadJournal]);

  async function onLoadMore() {
    setLoadingMore(true);
    try {
      await loadJournal(entries?.length ?? 0);
    } catch (e) {
      setJournalError(e instanceof Error ? e.message : "Алдаа");
    } finally {
      setLoadingMore(false);
    }
  }

  async function onTopup(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(topupAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setTopupSaving(true);
    try {
      await billing.topup(org.org_id, {
        amount_mnt: Math.round(amount),
        note: topupNote.trim() || null,
      });
      notify("success", `${org.name}: ${mnt(Math.round(amount))} цэнэглэлээ.`);
      setTopupAmount("");
      setTopupNote("");
      onChanged();
      await loadJournal(0);
    } catch (err) {
      notify(
        "danger",
        err instanceof Error ? err.message : "Цэнэглэж чадсангүй",
      );
    } finally {
      setTopupSaving(false);
    }
  }

  async function onGrantCredit(e: React.FormEvent) {
    e.preventDefault();
    if (!creditUntil) return;
    const until = new Date(creditUntil);
    if (Number.isNaN(until.getTime())) return;
    setCreditSaving(true);
    try {
      await billing.grantCredit(org.org_id, {
        until: until.toISOString(),
        note: creditNote.trim() || null,
      });
      notify("success", `${org.name}: яаралтай нээлт олголоо.`);
      setCreditUntil("");
      setCreditNote("");
      onChanged();
    } catch (err) {
      notify("danger", err instanceof Error ? err.message : "Нээж чадсангүй");
    } finally {
      setCreditSaving(false);
    }
  }

  async function onRevokeCredit() {
    setCreditSaving(true);
    try {
      await billing.revokeCredit(org.org_id);
      notify("success", `${org.name}: яаралтай нээлтийг цуцаллаа.`);
      onChanged();
    } catch (err) {
      notify(
        "danger",
        err instanceof Error ? err.message : "Цуцалж чадсангүй",
      );
    } finally {
      setCreditSaving(false);
    }
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <ModalHeader>
          <ModalTitle className="flex flex-wrap items-center gap-2">
            {org.name}
            <Badge tone={STATUS_TONE[org.status]}>
              {STATUS_LABEL[org.status]}
            </Badge>
          </ModalTitle>
        </ModalHeader>

        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-(--color-muted-foreground)">Үлдэгдэл</div>
            <div
              className={`text-lg font-semibold tabular-nums ${
                org.balance_mnt < 0 ? "text-(--color-danger)" : ""
              }`}
            >
              {mnt(org.balance_mnt)}
            </div>
          </div>
          <div>
            <div className="text-(--color-muted-foreground)">
              Өдрийн тариф
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {mnt(org.daily_rate_mnt)}
            </div>
          </div>
          <div>
            <div className="text-(--color-muted-foreground)">
              Дэлгүүр / камер
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {org.stores_count} / {org.cameras_count}
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* top-up */}
          <form
            className="space-y-3 rounded-(--radius) border border-(--color-border) p-4"
            onSubmit={onTopup}
          >
            <div className="font-medium">Цэнэглэх</div>
            <Field label="Дүн (₮)" required>
              <Input
                required
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                placeholder="100000"
                disabled={topupSaving}
              />
            </Field>
            <Field label="Тэмдэглэл">
              <Input
                value={topupNote}
                onChange={(e) => setTopupNote(e.target.value)}
                placeholder="Жишээ: Хаан банк шилжүүлэг"
                disabled={topupSaving}
              />
            </Field>
            <Button
              type="submit"
              size="sm"
              disabled={topupSaving || !(Number(topupAmount) > 0)}
            >
              {topupSaving ? "Хадгалж байна…" : "Цэнэглэх"}
            </Button>
          </form>

          {/* emergency credit */}
          <form
            className="space-y-3 rounded-(--radius) border border-(--color-border) p-4"
            onSubmit={onGrantCredit}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">Яаралтай нээх</span>
              {org.credit_until && (
                <Badge tone="warning">
                  {formatDateTime(org.credit_until)} хүртэл
                </Badge>
              )}
            </div>
            <Field
              label="Хүртэл огноо"
              required
              hint="Төлбөргүй ч системийг энэ хугацаа хүртэл нээлттэй байлгана"
            >
              <Input
                required
                type="datetime-local"
                value={creditUntil}
                onChange={(e) => setCreditUntil(e.target.value)}
                disabled={creditSaving}
              />
            </Field>
            <Field label="Тэмдэглэл">
              <Input
                value={creditNote}
                onChange={(e) => setCreditNote(e.target.value)}
                placeholder="Жишээ: маргааш төлнө гэсэн"
                disabled={creditSaving}
              />
            </Field>
            {org.credit_until && (
              <p className="text-xs text-[var(--color-warning,#d97706)]">
                Яаралтай нээлттэй хугацаанд өдрийн хэрэглээ үргэлжлэн
                тооцогдоно — үлдэгдэл хасах руу гүнзгийрч болзошгүй.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={creditSaving || !creditUntil}
              >
                {creditSaving ? "Хадгалж байна…" : "Нээх"}
              </Button>
              {org.credit_until && (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={creditSaving}
                  onClick={() => void onRevokeCredit()}
                >
                  Цуцлах
                </Button>
              )}
            </div>
          </form>
        </div>

        {/* journal */}
        <div className="space-y-2">
          <div className="font-medium">Гүйлгээний түүх</div>
          {journalError ? (
            <p className="text-sm text-(--color-danger)">{journalError}</p>
          ) : entries === null ? (
            <Spinner />
          ) : entries.length === 0 ? (
            <p className="text-sm text-(--color-muted-foreground)">
              Гүйлгээ алга байна.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Огноо</TableHead>
                    <TableHead>Төрөл</TableHead>
                    <TableHead>Dr / Cr</TableHead>
                    <TableHead className="text-right">Дүн</TableHead>
                    <TableHead>Тайлбар</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-(--color-muted-foreground)">
                        {formatDateTime(e.posted_at)}
                      </TableCell>
                      <TableCell>{KIND_LABEL[e.kind]}</TableCell>
                      <TableCell className="text-xs text-(--color-muted-foreground)">
                        {ACCOUNT_LABEL[e.dr_account]} →{" "}
                        {ACCOUNT_LABEL[e.cr_account]}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {mnt(e.amount_mnt)}
                      </TableCell>
                      <TableCell>
                        {e.description}
                        {e.charge_date && (
                          <span className="text-xs text-(--color-muted-foreground)">
                            {" "}
                            ({e.charge_date})
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {hasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void onLoadMore()}
                >
                  {loadingMore ? "Ачааллаж байна…" : "Цааш ачаалах"}
                </Button>
              )}
            </>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}

// --- promo codes ---------------------------------------------------------------

function CreatePromoModal({
  open,
  onClose,
  onSaved,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  notify: (tone: "success" | "danger", text: string) => void;
}) {
  const [kind, setKind] = useState<PromoKind>("bonus_amount");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [freeDays, setFreeDays] = useState("");
  const [validUntil, setValidUntil] = useState("");
  // True once the operator hand-edits the calendar, so we stop auto-filling it.
  const [validUntilTouched, setValidUntilTouched] = useState(false);
  const [maxRedemptions, setMaxRedemptions] = useState("1");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKind("bonus_amount");
      setCode("");
      setAmount("");
      setFreeDays("");
      setValidUntil("");
      setValidUntilTouched(false);
      setMaxRedemptions("1");
      setNote("");
      setError(null);
    }
  }, [open]);

  // "Үнэгүй өдөр" код: оруулсан өдрийн тоогоор хүчинтэй хугацааг ОДООГООС
  // автоматаар тооцож календарт бөглөнө (гараар тааруулж зөрүү гаргахгүй).
  // Операторын гар засварыг (validUntilTouched) дарж бичихгүй.
  useEffect(() => {
    if (kind !== "free_days" || validUntilTouched) return;
    const days = Math.floor(Number(freeDays));
    if (!Number.isFinite(days) || days <= 0) {
      setValidUntil("");
      return;
    }
    setValidUntil(toDatetimeLocal(new Date(Date.now() + days * 86_400_000)));
  }, [kind, freeDays, validUntilTouched]);

  const valueOk =
    kind === "bonus_amount" ? Number(amount) > 0 : Number(freeDays) > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await billing.createPromoCode({
        code: code.trim() || null,
        kind,
        amount_mnt: kind === "bonus_amount" ? Math.round(Number(amount)) : null,
        free_days: kind === "free_days" ? Math.round(Number(freeDays)) : null,
        valid_until: validUntil ? new Date(validUntil).toISOString() : null,
        max_redemptions: Math.max(1, Math.round(Number(maxRedemptions) || 1)),
        note: note.trim() || null,
      });
      notify("success", `Промо код үүслээ: ${created.code}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Үүсгэж чадсангүй");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Шинэ промо код</ModalTitle>
        </ModalHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <Field label="Төрөл" required>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as PromoKind)}
              disabled={saving}
            >
              <option value="bonus_amount">Дүнгийн кредит (₮)</option>
              <option value="free_days">Үнэгүй өдөр</option>
            </Select>
          </Field>
          {kind === "bonus_amount" ? (
            <Field label="Дүн (₮)" required>
              <Input
                required
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50000"
                disabled={saving}
              />
            </Field>
          ) : (
            <Field label="Өдрийн тоо" required>
              <Input
                required
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={freeDays}
                onChange={(e) => setFreeDays(e.target.value)}
                placeholder="14"
                disabled={saving}
              />
            </Field>
          )}
          <Field
            label="Код"
            hint="Хоосон үлдээвэл автоматаар үүсгэнэ (8 тэмдэгт)"
          >
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={32}
              placeholder="NAADAM26"
              disabled={saving}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Хүчинтэй дуусах"
              hint={
                kind === "free_days"
                  ? "Өдрийн тоогоор автоматаар бөглөгдөнө — өөрчилж болно"
                  : "Хоосон бол ямар ч хугацаагаар"
              }
            >
              <Input
                type="datetime-local"
                value={validUntil}
                onChange={(e) => {
                  setValidUntil(e.target.value);
                  setValidUntilTouched(true);
                }}
                disabled={saving}
              />
            </Field>
            <Field label="Max ашиглалт" required>
              <Input
                required
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                disabled={saving}
              />
            </Field>
          </div>
          <Field label="Тэмдэглэл">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Жишээ: Наадмын урамшуулал"
              disabled={saving}
            />
          </Field>
          {error && (
            <p className="text-sm text-(--color-danger)">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Болих
            </Button>
            <Button type="submit" disabled={saving || !valueOk}>
              {saving ? "Хадгалж байна…" : "Үүсгэх"}
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}

function PromoSection({
  notify,
}: {
  notify: (tone: "success" | "danger", text: string) => void;
}) {
  const [codes, setCodes] = useState<PromoCodePublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setCodes(await billing.listPromoCodes());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggleActive(promo: PromoCodePublic) {
    setTogglingId(promo.id);
    try {
      await billing.updatePromoCode(promo.id, { active: !promo.active });
      notify(
        "success",
        `${promo.code}: ${promo.active ? "идэвхгүй боллоо" : "идэвхжлээ"}.`,
      );
      await reload();
    } catch (e) {
      notify("danger", e instanceof Error ? e.message : "Шинэчилж чадсангүй");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Промо кодууд</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Шинэ код
        </Button>
      </CardHeader>
      <CardContent className={codes && codes.length > 0 ? "p-0" : undefined}>
        {error ? (
          <ErrorState message={error} onRetry={() => void reload()} />
        ) : codes === null ? (
          <Spinner />
        ) : codes.length === 0 ? (
          <EmptyState
            icon={Ticket}
            title="Промо код алга"
            description="Эхний урамшууллын кодоо үүсгэнэ үү."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Код</TableHead>
                <TableHead>Төрөл</TableHead>
                <TableHead className="text-right">Дүн / өдөр</TableHead>
                <TableHead className="text-right">Ашиглалт</TableHead>
                <TableHead>Хүчинтэй хугацаа</TableHead>
                <TableHead>Төлөв</TableHead>
                <TableHead>Тэмдэглэл</TableHead>
                <TableHead className="w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono font-medium">
                    {p.code}
                  </TableCell>
                  <TableCell>{PROMO_KIND_LABEL[p.kind]}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.kind === "bonus_amount"
                      ? mnt(p.amount_mnt ?? 0)
                      : `${p.free_days ?? 0} өдөр`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.redeemed_count} / {p.max_redemptions}
                  </TableCell>
                  <TableCell className="text-(--color-muted-foreground)">
                    {p.valid_until
                      ? `${formatDateTime(p.valid_until)} хүртэл`
                      : "Хугацаагүй"}
                  </TableCell>
                  <TableCell>
                    <Badge tone={p.active ? "success" : "neutral"}>
                      {p.active ? "Идэвхтэй" : "Идэвхгүй"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-(--color-muted-foreground)">
                    {p.note || "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={togglingId === p.id}
                      onClick={() => void toggleActive(p)}
                    >
                      {p.active ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CreatePromoModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          void reload();
        }}
        notify={notify}
      />
    </Card>
  );
}

// --- page --------------------------------------------------------------------

export function BillingPage() {
  const { toasts, push, remove } = useToasts();
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<BillingAnalytics | null>(null);
  const [range, setRange] = useState("30d");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const reloadOverview = useCallback(async () => {
    setOverviewError(null);
    try {
      setOverview(await billing.overview());
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : "Алдаа");
    }
  }, []);

  useEffect(() => {
    void reloadOverview();
  }, [reloadOverview]);

  useEffect(() => {
    let cancelled = false;
    setAnalytics(null);
    billing.analytics(range).then(
      (d) => !cancelled && setAnalytics(d),
      () => !cancelled && setAnalytics({
        by_day: [],
        totals: { day: range, usage_mnt: 0, topup_mnt: 0, promo_mnt: 0 },
        suspended_count: 0,
        credit_count: 0,
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [range]);

  const today = new Date().toISOString().slice(0, 10);
  const todayUsage =
    analytics?.by_day.find((p) => p.day === today)?.usage_mnt ?? 0;

  const selectedOrg =
    overview?.orgs.find((o) => o.org_id === selectedOrgId) ?? null;

  const kpis = overview
    ? [
        {
          label: "Нийт үлдэгдэл",
          value: mnt(overview.total_balance_mnt),
          icon: Wallet,
          danger: overview.total_balance_mnt < 0,
        },
        {
          label: "Өнөөдрийн орлого",
          value: mnt(todayUsage),
          icon: CalendarClock,
          danger: false,
        },
        {
          label: "Идэвхтэй",
          value: String(overview.active_count),
          icon: BadgeCheck,
          danger: false,
        },
        {
          label: "Зээлтэй / Хаагдсан",
          value: `${overview.credit_count} / ${overview.suspended_count}`,
          icon: AlertTriangle,
          danger: overview.suspended_count > 0,
        },
      ]
    : [];

  return (
    <ToastProvider>
      <div className="space-y-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Төлбөр</h1>
          {overview && (
            <span className="text-sm text-(--color-muted-foreground)">
              Нийт өдрийн тариф: {mnt(overview.total_daily_rate_mnt)}
            </span>
          )}
        </div>

        {overviewError ? (
          <ErrorState
            message={overviewError}
            onRetry={() => void reloadOverview()}
          />
        ) : overview === null ? (
          <Spinner />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {kpis.map(({ label, value, icon: Icon, danger }) => (
                <Card key={label}>
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                    <CardTitle className="text-sm text-(--color-muted-foreground)">
                      {label}
                    </CardTitle>
                    <Icon className="h-4 w-4 text-(--color-muted-foreground)" />
                  </CardHeader>
                  <CardContent>
                    <span
                      className={`text-2xl font-semibold tabular-nums ${
                        danger ? "text-(--color-danger)" : ""
                      }`}
                    >
                      {value}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>

            <RevenueChart data={analytics} range={range} onRange={setRange} />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Харилцагчид</CardTitle>
              </CardHeader>
              <CardContent className={overview.orgs.length > 0 ? "p-0" : undefined}>
                {overview.orgs.length === 0 ? (
                  <EmptyState
                    icon={Wallet}
                    title="Байгууллага алга"
                    description="Билл хийх байгууллага одоогоор алга байна."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Байгууллага</TableHead>
                        <TableHead className="text-right">Дэлгүүр</TableHead>
                        <TableHead className="text-right">Камер</TableHead>
                        <TableHead className="text-right">Өдрийн тариф</TableHead>
                        <TableHead className="text-right">Үлдэгдэл</TableHead>
                        <TableHead>Төлөв</TableHead>
                        <TableHead>Зээл хүртэл</TableHead>
                        <TableHead>Сүүлийн цэнэглэлт</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.orgs.map((o) => (
                        <TableRow
                          key={o.org_id}
                          className="cursor-pointer"
                          onClick={() => setSelectedOrgId(o.org_id)}
                        >
                          <TableCell>
                            <div className="font-medium">{o.name}</div>
                            <div className="text-xs text-(--color-muted-foreground)">
                              {o.slug}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {o.stores_count}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {o.cameras_count}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {mnt(o.daily_rate_mnt)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-medium tabular-nums ${
                              o.balance_mnt < 0
                                ? "text-(--color-danger)"
                                : ""
                            }`}
                          >
                            {mnt(o.balance_mnt)}
                          </TableCell>
                          <TableCell>
                            <Badge tone={STATUS_TONE[o.status]}>
                              {STATUS_LABEL[o.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-(--color-muted-foreground)">
                            {o.credit_until
                              ? formatDateTime(o.credit_until)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-(--color-muted-foreground)">
                            {o.last_topup_at
                              ? formatDate(o.last_topup_at)
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <PromoSection notify={push} />
          </>
        )}

        {selectedOrg && (
          <OrgBillingModal
            org={selectedOrg}
            onClose={() => setSelectedOrgId(null)}
            onChanged={() => void reloadOverview()}
            notify={push}
          />
        )}
      </div>

      {toasts.map((t) => (
        <Toast
          key={t.id}
          tone={t.tone}
          duration={4000}
          onOpenChange={(open) => !open && remove(t.id)}
        >
          <ToastDescription>{t.text}</ToastDescription>
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
