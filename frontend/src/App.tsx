import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import StartHere from './pages/StartHere';
import EmployeeTasks from './pages/EmployeeTasks';
import HrDashboard from './pages/HrDashboard';
import HrOverview from './pages/HrOverview';
import TaskOwnerDashboard from './pages/TaskOwnerDashboard';
import Community from './pages/Community';
import AdminNotes from './pages/AdminNotes';
import Documents from './pages/Documents';
import Benefits from './pages/Benefits';
import CompanyLife from './pages/CompanyLife';
import WorkLog from './pages/WorkLog';
import AuditLog from './pages/AuditLog';

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
                {/* /hr is where HR lands on login and is deliberately
                    unchanged; /hr/overview is the new Dashboard roster. */}
                <Route path="/hr" element={<HrDashboard />} />
                <Route path="/hr/overview" element={<HrOverview />} />
                <Route path="/notes-admin" element={<AdminNotes />} />
              </Route>

              <Route path="/benefits" element={<Benefits />} />
              <Route path="/community" element={<Community />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/events" element={<CompanyLife />} />
              <Route path="/work-log" element={<WorkLog />} />
              <Route path="/audit-log" element={<AuditLog />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
