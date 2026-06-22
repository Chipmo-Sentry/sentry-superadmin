import { Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { RequireSuperAdmin } from "@/components/RequireSuperAdmin";
import { BehaviorsPage } from "@/pages/BehaviorsPage";
import { AiNodesPage } from "@/pages/AiNodesPage";
import { BillingPage } from "@/pages/BillingPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { EdgeConfigPage } from "@/pages/EdgeConfigPage";
import { LeadsPage } from "@/pages/LeadsPage";
import { LogsPage } from "@/pages/LogsPage";
import { LoginPage } from "@/pages/LoginPage";
import { OrgDetailPage } from "@/pages/OrgDetailPage";
import { OrgsPage } from "@/pages/OrgsPage";
import { PipelinePage } from "@/pages/PipelinePage";
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
          <Route path="leads" element={<LeadsPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="ai-nodes" element={<AiNodesPage />} />
          <Route path="pipeline" element={<PipelinePage />} />
          <Route path="behaviors" element={<BehaviorsPage />} />
          <Route path="edge-config" element={<EdgeConfigPage />} />
          <Route path="logs" element={<LogsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
