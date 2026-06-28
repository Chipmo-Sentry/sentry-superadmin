import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Select,
  Spinner,
} from "@chipmo-sentry/ui-kit";
import { useEffect, useState } from "react";

import { admin, events as eventsApi } from "@/lib/api";
import {
  clockMs,
  dayKey,
  EVENT_GROUPS,
  EVENT_LABEL,
  SEVERITY_TONE,
} from "@/lib/event-log";
import type { EventLogPublic, EventType, OrganizationPublic } from "@/lib/types";

const PAGE_SIZE = 50;

export function LogsPage() {
  const [history, setHistory] = useState<EventLogPublic[] | null>(null);
  const [live, setLive] = useState<EventLogPublic[]>([]);
  const [connected, setConnected] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [orgs, setOrgs] = useState<OrganizationPublic[]>([]);
  const [orgId, setOrgId] = useState<string>(""); // "" = all orgs
  const [activeGroups, setActiveGroups] = useState<Set<string>>(new Set());
  const [showHeartbeats, setShowHeartbeats] = useState(false);

  const selectedTypes = (): EventType[] | undefined => {
    if (activeGroups.size === 0) return undefined;
    return EVENT_GROUPS.filter((g) => activeGroups.has(g.label)).flatMap((g) => g.types);
  };
  const typeSet = (() => {
    const t = selectedTypes();
    return t ? new Set(t) : null;
  })();

  useEffect(() => {
    admin.listOrgs().then(setOrgs, () => setOrgs([]));
  }, []);

  // (Re)load first page on any server-side filter change.
  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setLive([]);
    eventsApi
      .list({
        limit: PAGE_SIZE,
        offset: 0,
        org_id: orgId || undefined,
        event_type: selectedTypes(),
        include_heartbeats: showHeartbeats,
      })
      .then(
        (list) => {
          if (cancelled) return;
          setHistory(list);
          setHasMore(list.length === PAGE_SIZE);
        },
        (e) => {
          if (!cancelled) setSeedError(e instanceof Error ? e.message : "Алдаа");
        },
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, activeGroups, showHeartbeats]);

  // Live SSE — all orgs. Client-side filters apply to streamed rows.
  useEffect(() => {
    const es = new EventSource(eventsApi.streamUrl(), { withCredentials: true });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("log", (e) => {
      try {
        const row = JSON.parse((e as MessageEvent).data) as EventLogPublic;
        setLive((prev) => [row, ...prev].slice(0, 500));
      } catch {
        // ignore malformed frame
      }
    });
    return () => es.close();
  }, []);

  async function loadMore() {
    if (loadingMore || !history) return;
    setLoadingMore(true);
    try {
      const next = await eventsApi.list({
        limit: PAGE_SIZE,
        offset: history.length,
        org_id: orgId || undefined,
        event_type: selectedTypes(),
        include_heartbeats: showHeartbeats,
      });
      setHistory((prev) => [...(prev ?? []), ...next]);
      setHasMore(next.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleGroup(label: string) {
    setActiveGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const merged: EventLogPublic[] = (() => {
    const base = history ?? [];
    const seen = new Set<string>();
    const out: EventLogPublic[] = [];
    for (const ev of [...live, ...base]) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      if (!showHeartbeats && ev.is_heartbeat) continue;
      if (typeSet && !typeSet.has(ev.event_type)) continue;
      if (orgId && ev.organization_id !== orgId) continue;
      out.push(ev);
    }
    return out;
  })();

  if (seedError) {
    return (
      <div className="p-6">
        <ErrorState message={seedError} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Лог</h1>
        <Badge tone={connected ? "success" : "warning"}>
          {connected ? "Шууд холбогдсон" : "Холболтгүй"}
        </Badge>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          className="w-56"
        >
          <option value="">Бүх байгууллага</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        {EVENT_GROUPS.map((g) => {
          const active = activeGroups.has(g.label);
          return (
            <button
              key={g.label}
              type="button"
              onClick={() => toggleGroup(g.label)}
              aria-pressed={active}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-(--color-primary) text-(--color-primary-foreground)"
                  : "border border-(--color-border) text-(--color-muted-foreground) hover:bg-(--color-muted)"
              }`}
            >
              {g.label}
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-2 text-xs text-(--color-muted-foreground)">
          <input
            type="checkbox"
            checked={showHeartbeats}
            onChange={(e) => setShowHeartbeats(e.target.checked)}
            className="h-4 w-4"
          />
          Heartbeat харуулах
        </label>
      </div>

      {history === null ? (
        <div className="p-8">
          <Spinner />
        </div>
      ) : merged.length === 0 ? (
        <EmptyState title="Лог алга" description="Үйл явдал бүртгэгдэх үед энд гарч ирнэ." />
      ) : (
        <>
          <LogTable rows={merged} orgs={orgs} />
          {hasMore ? (
            <div className="mt-6 flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Ачаалж байна…" : "Цааш үзэх"}
              </Button>
            </div>
          ) : (
            <p className="mt-6 text-center text-xs text-(--color-muted-foreground)">
              Бүх лог ачаалагдсан
            </p>
          )}
        </>
      )}
    </div>
  );
}

function LogTable({
  rows,
  orgs,
}: {
  rows: EventLogPublic[];
  orgs: OrganizationPublic[];
}) {
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const groups: { day: string; rows: EventLogPublic[] }[] = [];
  for (const r of rows) {
    const day = dayKey(r.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else groups.push({ day, rows: [r] });
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.day}>
          <div className="sticky top-0 z-10 mb-1 bg-(--color-background) py-1 text-xs font-semibold text-(--color-muted-foreground)">
            {g.day}
          </div>
          <ul className="divide-y divide-(--color-border) rounded-lg border border-(--color-border)">
            {g.rows.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-(--color-muted-foreground)">
                  {clockMs(r.created_at)}
                </span>
                <Badge tone={SEVERITY_TONE[r.severity]}>
                  {EVENT_LABEL[r.event_type] ?? r.event_type}
                </Badge>
                <span className="min-w-0 flex-1 wrap-break-word">
                  {r.message}
                  {r.actor_label ? (
                    <span className="ml-1.5 text-xs text-(--color-muted-foreground)">
                      · {r.actor_label}
                    </span>
                  ) : null}
                </span>
                {r.organization_id ? (
                  <span className="shrink-0 text-xs text-(--color-muted-foreground)">
                    {orgName.get(r.organization_id) ?? "—"}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-(--color-muted-foreground)">
                    Платформ
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
