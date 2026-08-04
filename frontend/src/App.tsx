import { BrowserRouter, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/layout/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "@/pages/Login";
import AcceptInvite from "@/pages/AcceptInvite";
import ExecutiveDashboard from "@/pages/ExecutiveDashboard";
import OrgAdmin from "@/pages/OrgAdmin";
import OrgChart from "@/pages/OrgChart";
import UserManagement from "@/pages/UserManagement";
import RbacAdmin from "@/pages/RbacAdmin";
import Projects from "@/pages/Projects";
import Tasks from "@/pages/Tasks";
import Goals from "@/pages/Goals";
import MyScorecard from "@/pages/MyScorecard";
import LeadershipScorecard from "@/pages/LeadershipScorecard";
import AccountSettings from "@/pages/AccountSettings";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Routes>
                  <Route path="/" element={<ExecutiveDashboard />} />
                  <Route path="/org-chart" element={<OrgChart />} />
                  <Route path="/projects" element={<Projects />} />
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/scorecard" element={<MyScorecard />} />
                  <Route path="/leadership-scorecard" element={<LeadershipScorecard />} />
                  <Route path="/goals" element={<Goals />} />
                  <Route path="/admin/org" element={<OrgAdmin />} />
                  <Route path="/admin/rbac" element={<RbacAdmin />} />
                  <Route path="/admin/users" element={<UserManagement />} />
                  <Route path="/settings" element={<AccountSettings />} />
                </Routes>
              </AppLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
