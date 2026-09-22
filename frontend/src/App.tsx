import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import StartHere from './pages/StartHere';
import EmployeeTasks from './pages/EmployeeTasks';
import HrDashboard from './pages/HrDashboard';
import TaskOwnerDashboard from './pages/TaskOwnerDashboard';
import Documents from './pages/Documents';
import Benefits from './pages/Benefits';
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
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<RoleHome />} />

              <Route element={<ProtectedRoute allow={['employee']} />}>
                <Route path="/start-here" element={<StartHere />} />
                {/* Tasks moved off the Home page onto their own route so the
                    serpentine trail has room and Home stays a landing page. */}
                <Route path="/tasks" element={<EmployeeTasks />} />
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
              </Route>

              <Route path="/benefits" element={<Benefits />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/audit-log" element={<AuditLog />} />
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
    </AuthProvider>
  );
}
