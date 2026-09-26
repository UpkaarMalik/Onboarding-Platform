import type { TaskGuide } from '../../data/taskGuides';

/**
 * The body of a task popup for any task we have written a guide for.
 *
 * Three bands, in the order someone actually needs them: what this is for,
 * what to do, and where to get it. The tip comes last because it is the part
 * you want on the way out rather than on the way in.
 *
 * Renders nothing structural of its own when a section is absent — a task with
 * steps but no downloads simply has no downloads band, rather than an empty
 * heading. Guides in data/taskGuides.ts vary that way on purpose: "meet your
 * buddy" has nothing to install.
 */
export default function TaskGuideView({ guide }: { guide: TaskGuide }) {
  return (
    <div className="task-guide">
      <p className="task-guide__summary">{guide.summary}</p>

      {/* A guide whose task carries a checklist has no steps of its own — the
          cards under it are the steps. Rendering the heading anyway would put
          "What to do" above nothing. */}
      {guide.steps.length > 0 && (
      <section className="task-guide__section">
        <h3 className="task-guide__heading">
          <StepsIcon />
          What to do
        </h3>
        <ol className="task-guide__steps">
          {guide.steps.map((step, i) => (
            <li key={step.title} className="task-guide__step" style={{ ['--i' as string]: i }}>
              <span className="task-guide__step-num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="task-guide__step-body">
                <strong className="task-guide__step-title">{step.title}</strong>
                {step.detail && <p className="task-guide__step-detail">{step.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
      )}

      {guide.resources && guide.resources.length > 0 && (
        <section className="task-guide__section task-guide__section--panel">
          <h3 className="task-guide__heading">
            <DownloadIcon />
            Where to get it
          </h3>
          <div className="task-guide__links">
            {guide.resources.map((r) => (
              <a
                key={r.href}
                className="task-guide__link"
                href={r.href}
                target="_blank"
                /* noreferrer alongside noopener because these are outbound
                   vendor links from a page that carries a signed-in session —
                   there is no reason to hand them the referrer. */
                rel="noopener noreferrer"
              >
                <span className="task-guide__link-text">
                  <strong>{r.label}</strong>
                  {r.note && <span className="task-guide__link-note">{r.note}</span>}
                </span>
                <span className="task-guide__link-arrow" aria-hidden="true">
                  <ExternalIcon />
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {guide.tip && (
        <aside className="task-guide__tip">
          <span className="task-guide__tip-mark" aria-hidden="true">
            <BulbIcon />
          </span>
          <p>{guide.tip}</p>
        </aside>
      )}
    </div>
  );
}

function StepsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13" strokeLinecap="round" />
      <circle cx="3.5" cy="6" r="1.5" />
      <circle cx="3.5" cy="12" r="1.5" />
      <circle cx="3.5" cy="18" r="1.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="M7.5 10.5L12 15l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 16L16 8M9 8h7v7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BulbIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M9 18h6M10 21h4" strokeLinecap="round" />
      <path
        d="M12 3a6 6 0 00-3.5 10.9c.3.2.5.6.5 1V16h6v-1.1c0-.4.2-.8.5-1A6 6 0 0012 3z"
        strokeLinejoin="round"
      />
    </svg>
  );
}
