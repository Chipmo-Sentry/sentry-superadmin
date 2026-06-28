import { Avatar, AvatarFallback, Button, Logo } from "@chipmo-sentry/ui-kit";
import {
  Brain,
  Building2,
  Cpu,
  Inbox,
  LayoutDashboard,
  LogOut,
  MonitorCog,
  ScrollText,
  Users,
  Wallet,
  Workflow,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "@/context/AuthContext";

const NAV = [
  { to: "/", label: "Хяналтын самбар", icon: LayoutDashboard, end: true },
  { to: "/orgs", label: "Байгууллагууд", icon: Building2, end: false },
  { to: "/users", label: "Хэрэглэгчид", icon: Users, end: false },
  { to: "/leads", label: "Demo хүсэлтүүд", icon: Inbox, end: false },
  { to: "/billing", label: "Төлбөр", icon: Wallet, end: false },
  { to: "/ai-nodes", label: "AI сервер", icon: Cpu, end: false },
  { to: "/pipeline", label: "Урсгал", icon: Workflow, end: false },
  { to: "/behaviors", label: "Сэжиг шалгуур", icon: Brain, end: false },
  { to: "/edge-config", label: "Edge тохиргоо", icon: MonitorCog, end: false },
  { to: "/logs", label: "Лог", icon: ScrollText, end: false },
] as const;

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const email = user ? user.email : "";
  const initial = email ? email[0]!.toUpperCase() : "?";

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-(--color-border) bg-(--color-muted)">
        <div className="flex items-center gap-2 px-5 py-4">
          <Logo className="h-7 w-auto" />
          <span className="text-sm font-semibold">Super Admin</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-(--radius) px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-(--color-primary) text-(--color-primary-foreground)"
                    : "text-(--color-foreground) hover:bg-(--color-background)"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-(--color-border) p-3">
          <div className="mb-2 flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            <span className="truncate text-xs text-(--color-muted-foreground)">
              {email}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={onLogout}
          >
            <LogOut className="h-4 w-4" />
            Гарах
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
