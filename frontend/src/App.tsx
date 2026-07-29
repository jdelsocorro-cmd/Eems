import { BrowserRouter, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/layout/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "@/pages/Login";
import ExecutiveDashboard from "@/pages/ExecutiveDashboard";
import PlaceholderPage from "@/pages/PlaceholderPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Routes>
                  <Route path="/" element={<ExecutiveDashboard />} />
                  <Route path="/org-chart" element={<PlaceholderPage title="Org Chart" />} />
                  <Route path="/projects" element={<PlaceholderPage title="Projects" />} />
                  <Route path="/tasks" element={<PlaceholderPage title="My Tasks" />} />
                  <Route path="/scorecard" element={<PlaceholderPage title="My Scorecard" />} />
                  <Route path="/goals" element={<PlaceholderPage title="Goals" />} />
                  <Route path="/admin/org" element={<PlaceholderPage title="Org Admin" />} />
                  <Route path="/admin/rbac" element={<PlaceholderPage title="RBAC Admin" />} />
                  <Route path="/admin/users" element={<PlaceholderPage title="Users" />} />
                </Routes>
              </AppLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
