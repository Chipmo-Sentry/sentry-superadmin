import { Button, EmptyState, Spinner } from "@chipmo-sentry/ui-kit";
import { ShieldAlert } from "lucide-react";
import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "@/context/AuthContext";

/** Route guard: only authenticated super-admins reach the wrapped routes.
 * - checking (null)  → spinner
 * - anonymous (false) → redirect to /login
 * - signed in, not super-admin → forbidden screen */
export function RequireSuperAdmin() {
  const { user, logout } = useAuth();

  if (user === null) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }

  if (user === false) {
    return <Navigate to="/login" replace />;
  }

  if (!user.is_super_admin) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="space-y-4 text-center">
          <EmptyState
            icon={ShieldAlert}
            title="Хандах эрхгүй"
            description="Энэ хэсэг зөвхөн супер админд зориулагдсан."
          />
          <Button variant="ghost" onClick={() => void logout()}>
            Өөр хэрэглэгчээр нэвтрэх
          </Button>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
