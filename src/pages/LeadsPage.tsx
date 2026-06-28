import {
  Badge,
  Button,
  Card,
  CardContent,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@chipmo-sentry/ui-kit";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { admin } from "@/lib/api";
import type { LeadPublic, LeadStatus } from "@/lib/types";

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "Шинэ",
  contacted: "Холбогдсон",
  qualified: "Шалгарсан",
  closed: "Хаагдсан",
};

const STATUS_TONE: Record<
  LeadStatus,
  "notify" | "neutral" | "success" | "danger"
> = {
  new: "notify",
  contacted: "neutral",
  qualified: "success",
  closed: "danger",
};

const STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "closed"];

function formatDate(iso: string): string {
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

export function LeadsPage() {
  const [leads, setLeads] = useState<LeadPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setLeads(await admin.listLeads());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function setStatus(lead: LeadPublic, status: LeadStatus) {
    try {
      await admin.updateLead(lead.id, { status });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Шинэчилж чадсангүй");
    }
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Demo хүсэлтүүд</h1>
        {leads && (
          <span className="text-sm text-(--color-muted-foreground)">
            Нийт {leads.length}
          </span>
        )}
      </div>

      {error && <p className="text-(--color-danger)">{error}</p>}

      {leads === null && !error ? (
        <Spinner />
      ) : leads && leads.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-(--color-muted-foreground)">
            Одоогоор demo хүсэлт алга байна.
          </CardContent>
        </Card>
      ) : leads ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Огноо</TableHead>
                  <TableHead>Холбоо барих</TableHead>
                  <TableHead>Байгууллага</TableHead>
                  <TableHead>Салбар</TableHead>
                  <TableHead className="text-right">Камер</TableHead>
                  <TableHead>Төлөв</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="whitespace-nowrap text-(--color-muted-foreground)">
                      {formatDate(lead.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{lead.name || "—"}</div>
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-sm text-(--color-primary) hover:underline"
                      >
                        {lead.email}
                      </a>
                      {lead.phone && (
                        <div className="text-sm text-(--color-muted-foreground)">
                          {lead.phone}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{lead.organization || "—"}</TableCell>
                    <TableCell>{lead.industry || "—"}</TableCell>
                    <TableCell className="text-right">
                      {lead.camera_count ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[lead.status]}>
                        {STATUS_LABEL[lead.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Dropdown>
                        <DropdownTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Төлөв солих"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownTrigger>
                        <DropdownContent align="end">
                          {STATUSES.filter((s) => s !== lead.status).map((s) => (
                            <DropdownItem
                              key={s}
                              onSelect={() => void setStatus(lead, s)}
                            >
                              {STATUS_LABEL[s]} болгох
                            </DropdownItem>
                          ))}
                        </DropdownContent>
                      </Dropdown>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
