import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';
import { ToastProvider } from './components/Toast';
import Login from './pages/Login';
// PARKED-FEATURE: the old Start Here landing page. Home is the task trail
// now (see NAV_EMPLOYEE in Layout), so this page is unrouted rather than
// deleted — its private-notes, quick-access and rating sections are
// commented out inside it and come back by uncommenting.
// import StartHere from './pages/StartHere';
import EmployeeTasks from './pages/EmployeeTasks';
import HrDashboard from './pages/HrDashboard';
import TaskOwnerDashboard from './pages/TaskOwnerDashboard';
import Documents from './pages/Documents';
import Benefits from './pages/Benefits';
import MacTools from './pages/MacTools';
import Profile from './pages/Profile';
import AuditLog from './pages/AuditLog';
// PARKED-FEATURE: diary, community, gallery
//
// Parked, not removed — the pages, their backend modules and every
// route below are intact on disk and come back by uncommenting. Grep
// `PARKED-FEATURE` to find every piece: this file, Layout's nav arrays,
// StartHere's diary section and quick tiles, and the backend
// AppModule's DiaryModule/CommunityModule registration.
//
// import Community from './pages/Community';
// import CompanyLife from './pages/CompanyLife';
// import WorkLog from './pages/WorkLog';

function RoleHome() {
  const { user } = useAuth();
  if (user?.role === 'superadmin_hr') return <Navigate to="/hr" replace />;
  if (user?.role === 'task_owner') return <Navigate to="/my-tasks" replace />;
  return <Navigate to="/start-here" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      {/* Outside the router so a toast survives a navigation — "document
          uploaded" should still be readable on the page you land on. */}
      <ToastProvider>
        <BrowserRouter>
          <ScrollToTop />
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<RoleHome />} />

                <Route element={<ProtectedRoute allow={['employee']} />}>
                  {/* Home and the trail are one page. /tasks stays as a
                      redirect so an old bookmark or link still lands
                      somewhere real. */}
                  <Route path="/start-here" element={<EmployeeTasks />} />
                  <Route path="/tasks" element={<Navigate to="/start-here" replace />} />
                </Route>

                <Route element={<ProtectedRoute allow={['task_owner']} />}>
                  <Route path="/my-tasks" element={<TaskOwnerDashboard />} />
                </Route>

                <Route element={<ProtectedRoute allow={['superadmin_hr']} />}>
                  {/* /hr is where HR lands on login and now carries the roster
                      too. /hr/overview is kept only so old links and bookmarks
                      land somewhere sensible instead of on a 404. */}
                  <Route path="/hr" element={<HrDashboard />} />
                  <Route path="/hr/overview" element={<Navigate to="/hr" replace />} />
                  {/* The audit trail is HR-only end to end: GET
                      /activity-logs is @Roles('superadmin_hr'), so an
                      employee who typed this URL used to load a page that
                      could only ever 403. Now the route itself bounces
                      them to their own home. */}
                  <Route path="/audit-log" element={<AuditLog />} />
                </Route>

                {/* Every role has a profile, so this sits outside the
                    role-scoped groups above alongside the other shared
                    pages. */}
                <Route path="/profile" element={<Profile />} />
                <Route path="/benefits" element={<Benefits />} />
                <Route path="/documents" element={<Documents />} />
                <Route path="/mac-tools" element={<MacTools />} />
                {/* PARKED-FEATURE: diary, community, gallery. Unrouted rather
                    than redirected — the catch-all below already sends an old
                    /community or /work-log bookmark to the role's home page.
                <Route path="/community" element={<Community />} />
                <Route path="/events" element={<CompanyLife />} />
                <Route path="/work-log" element={<WorkLog />} />
                */}
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
