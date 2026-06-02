import { Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { RequireSuperAdmin } from "@/components/RequireSuperAdmin";
import { BehaviorsPage } from "@/pages/BehaviorsPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { OrgDetailPage } from "@/pages/OrgDetailPage";
import { OrgsPage } from "@/pages/OrgsPage";
import { UsersPage } from "@/pages/UsersPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireSuperAdmin />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="orgs" element={<OrgsPage />} />
          <Route path="orgs/:orgId" element={<OrgDetailPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="behaviors" element={<BehaviorsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
