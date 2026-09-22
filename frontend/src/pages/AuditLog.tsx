import ActivityLogPanel from '../components/ActivityLogPanel';

/**
 * The audit trail as its own page. HR normally reaches this content
 * through the drawer on their home, but the route stays — it is what a
 * bookmark, a shared link and the "View all activity" deep link land on,
 * and it is inside the superadmin_hr group in App.tsx so an employee
 * typing the URL is sent back to their own home.
 */
export default function AuditLog() {
  return (
    <div className="audit-log-page">
      <header className="audit-log-head">
        <span className="audit-log-eyebrow">System logs</span>
        <h1>Audit log</h1>
        <p className="muted">
          Every change anyone has made, newest first. Nothing here can be edited or deleted.
        </p>
      </header>
      <ActivityLogPanel />
    </div>
  );
}
