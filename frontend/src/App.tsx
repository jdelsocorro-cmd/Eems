import { BrowserRouter, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/layout/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import RequirePermission from "@/components/RequirePermission";
import Login from "@/pages/Login";
import SetPassword from "@/pages/SetPassword";
import ExecutiveDashboard from "@/pages/ExecutiveDashboard";
import OrgAdmin from "@/pages/OrgAdmin";
import OrgChart from "@/pages/OrgChart";
import UserManagement from "@/pages/UserManagement";
import RbacAdmin from "@/pages/RbacAdmin";
import Projects from "@/pages/Projects";
import Tasks from "@/pages/Tasks";
import ReviewQueue from "@/pages/ReviewQueue";
import Goals from "@/pages/Goals";
import MyScorecard from "@/pages/MyScorecard";
import LeadershipScorecard from "@/pages/LeadershipScorecard";
import PerformanceReviewCenter from "@/pages/PerformanceReviewCenter";
import HelpCenter from "@/pages/HelpCenter";
import HelpAdmin from "@/pages/HelpAdmin";
import SupportAdmin from "@/pages/SupportAdmin";
import AccountSettings from "@/pages/AccountSettings";
import Employee360 from "@/pages/Employee360";
import BulkImportAdmin from "@/pages/BulkImportAdmin";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/accept-invite" element={<SetPassword mode="invite" />} />
        <Route path="/reset-password" element={<SetPassword mode="reset" />} />
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
                  <Route path="/review-queue" element={<ReviewQueue />} />
                  <Route path="/scorecard" element={<MyScorecard />} />
                  <Route path="/leadership-scorecard" element={<LeadershipScorecard />} />
                  <Route path="/performance-review-center" element={<PerformanceReviewCenter />} />
                  <Route path="/goals" element={<Goals />} />
                  <Route
                    path="/admin/org"
                    element={
                      <RequirePermission resource="org_structure" action="manage">
                        <OrgAdmin />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/rbac"
                    element={
                      <RequirePermission resource="role" action="manage">
                        <RbacAdmin />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/users"
                    element={
                      <RequirePermission resource="employee" action="create">
                        <UserManagement />
                      </RequirePermission>
                    }
                  />
                  <Route path="/help" element={<HelpCenter />} />
                  <Route
                    path="/admin/help"
                    element={
                      <RequirePermission resource="help_articles" action="manage">
                        <HelpAdmin />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/support"
                    element={
                      <RequirePermission resource="support_tickets" action="review">
                        <SupportAdmin />
                      </RequirePermission>
                    }
                  />
                  <Route path="/settings" element={<AccountSettings />} />
                  <Route
                    path="/employees/:employeeId"
                    element={
                      <RequirePermission resource="employee" action="view_360">
                        <Employee360 />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/bulk-import"
                    element={
                      <RequirePermission resource="employee" action="bulk_import">
                        <BulkImportAdmin />
                      </RequirePermission>
                    }
                  />
                </Routes>
              </AppLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
