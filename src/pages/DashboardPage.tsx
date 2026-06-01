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
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { admin } from "@/lib/api";
import type { AdminStats } from "@/lib/types";

const CARDS: { key: keyof AdminStats; label: string; icon: LucideIcon }[] = [
  { key: "orgs", label: "Байгууллага", icon: Building2 },
  { key: "users", label: "Хэрэглэгч", icon: Users },
  { key: "stores", label: "Дэлгүүр", icon: Store },
  { key: "cameras", label: "Камер", icon: Cctv },
  { key: "alerts", label: "Сэжигтэй үйлдэл", icon: Bell },
];

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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
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
      ) : null}
    </div>
  );
}
