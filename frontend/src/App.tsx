import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/layout/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import RequirePermission from "@/components/RequirePermission";
import { LoadingState } from "@/components/ui";
import Login from "@/pages/Login";

// Every page used to be a static import, so visiting the Dashboard
// downloaded and parsed the code for Org Admin, RBAC Admin, Bulk Import,
// and everything else too -- one ~1MB bundle regardless of which single
// page you actually opened (flagged in the free-tier loading-speed review,
// 2026-09-04). React.lazy + Suspense splits each page into its own chunk,
// fetched only when its route is actually visited. Login stays a static
// import deliberately: it's the very first thing an unauthenticated visitor
// sees, and there's no page before it to show a Suspense fallback from.
const SetPassword = lazy(() => import("@/pages/SetPassword"));
const ExecutiveDashboard = lazy(() => import("@/pages/ExecutiveDashboard"));
const OrgAdmin = lazy(() => import("@/pages/OrgAdmin"));
const OrgChart = lazy(() => import("@/pages/OrgChart"));
const UserManagement = lazy(() => import("@/pages/UserManagement"));
const RbacAdmin = lazy(() => import("@/pages/RbacAdmin"));
const Projects = lazy(() => import("@/pages/Projects"));
const Tasks = lazy(() => import("@/pages/Tasks"));
const ReviewQueue = lazy(() => import("@/pages/ReviewQueue"));
const Goals = lazy(() => import("@/pages/Goals"));
const MyScorecard = lazy(() => import("@/pages/MyScorecard"));
const LeadershipScorecard = lazy(() => import("@/pages/LeadershipScorecard"));
const PerformanceReviewCenter = lazy(() => import("@/pages/PerformanceReviewCenter"));
const HelpCenter = lazy(() => import("@/pages/HelpCenter"));
const HelpAdmin = lazy(() => import("@/pages/HelpAdmin"));
const SupportAdmin = lazy(() => import("@/pages/SupportAdmin"));
const AccountSettings = lazy(() => import("@/pages/AccountSettings"));
const Employee360 = lazy(() => import("@/pages/Employee360"));
const BulkImportAdmin = lazy(() => import("@/pages/BulkImportAdmin"));

// Full-page fallback for routes reached before AppLayout's sidebar exists
// (the pre-auth routes below, and the initial auth check in ProtectedRoute)
// -- matches ProtectedRoute/RequirePermission's own existing loading style.
function FullPageLoading() {
  return <div className="flex min-h-screen items-center justify-center bg-bg text-text-muted">Loading...</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<FullPageLoading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/accept-invite" element={<SetPassword mode="invite" />} />
          <Route path="/reset-password" element={<SetPassword mode="reset" />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AppLayout>
                  {/* A second boundary here means navigating between pages
                      (sidebar already mounted) shows the lighter in-content
                      LoadingState instead of replacing the whole shell. */}
                  <Suspense fallback={<LoadingState label="Loading page..." />}>
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
                  </Suspense>
                </AppLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
