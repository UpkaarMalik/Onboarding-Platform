import type { ReactNode } from 'react';

/**
 * The band at the top of a role's home page: who you are, one line of
 * something true about right now, and the single action that page is for.
 *
 * Shared between HR's dashboard and the employee's Start Here so the two
 * cannot drift — before this, HR had a compact greeting card and the
 * employee had a 220px photo banner with a live clock over it, which took
 * a third of the screen to say less.
 *
 * `summary` is a node, not a string, because the interesting part of it is
 * usually emphasised — "3 joinees onboarding · 1 blocked" wants the blocked
 * count marked, and a plain string could not carry that.
 */
export default function PageHero({
  title,
  summary,
  action,
}: {
  title: ReactNode;
  summary: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="page-hero">
      <div className="page-hero-copy">
        <h1 className="page-hero-title">{title}</h1>
        <p className="page-hero-sub">{summary}</p>
      </div>
      {action && <div className="page-hero-action">{action}</div>}
    </section>
  );
}
