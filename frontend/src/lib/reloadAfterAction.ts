/**
 * Full-page reload after any action that changes something, landing the
 * person back where they were.
 *
 * The plain SPA behaviour — mutate, then have each listener re-read its
 * own slice — means every screen is only as fresh as the listeners
 * someone remembered to wire up, and a screen nobody wired shows stale
 * data with no sign that it is stale. Reloading is the blunt version
 * and it cannot be partially wrong: everything on the page comes back
 * from the server, including the activity log.
 *
 * What it costs is the place you were standing, which is why the two
 * halves below exist. rememberPlace() runs just before the reload and
 * restorePlace() runs at boot.
 */

const KEY = 'app:reload-place';
/** Older than this and it is not our reload — a tab restored from
 *  history, or a marker left by a reload that never happened. */
const FRESH_MS = 10_000;

/**
 * Paths that must NOT trigger a reload, and why each one would break.
 *
 *  /auth/refresh            fires every ~15 minutes on its own, and again
 *                           behind any 401. Reloading here is an endless
 *                           reload loop.
 *  /auth/login/password     the reload would land mid-handoff, before the
 *                           app has read who signed in.
 *  /auth/logout             already navigates to the login page itself.
 *  /notifications/…/read    this POST is half of "click a notification to
 *                           go somewhere" — a reload races the navigation
 *                           and cancels it.
 *  /onboardings/joinee      returns the new joinee's one-time password.
 *  …/regenerate-credentials the same, for an existing joinee.
 *
 * The last two are the ones worth being loud about: that password is
 * displayed exactly once and is not recoverable afterwards. A reload
 * there does not cost a scroll position, it costs an account nobody can
 * sign in to and a row HR has to fix by hand.
 */
const NO_RELOAD = [
  '/auth/',
  '/notifications/',
  '/onboardings/joinee',
  'regenerate-credentials',
  // Actions fired from the EmployeeProfileModal: document review, task
  // blocking, blocker resolution, and the HR-side "mark done". All of
  // these are inside a modal opened via React state, not the URL. A hard
  // reload dismisses the modal and — because HrDashboard reads ?profile=
  // from the URL on every mount — causes it to reopen from the URL param,
  // which is the "card keeps appearing" loop. The modal calls load() and
  // onChanged() itself after each action, so no data freshness is lost.
  '/joinee-documents/',
  '/block',
  '/complete-as-owner',
  '/blockers/',
  // The employee ticking off their own step — the counterpart to
  // /complete-as-owner above. EmployeeTasks calls loadAll() straight after
  // it, so nothing goes stale, and the reload costs something specific
  // here: the trail's mark keeps the leg it still has to fly in a ref, so
  // that finishing a step sends it from the step just done to the next one.
  // A remount resets that ref to the start of the trail, and the boomerang
  // replayed the whole journey from step one on every completion.
  '/complete-as-employee',
  // Ticking one item of a task's checklist, which is the same action as
  // /complete-as-employee above at a smaller grain and costs strictly more
  // when reloaded: the checklist lives inside an open popup, so a reload
  // does not merely reset the boomerang's leg — it shuts the popup the
  // person is working through, after every single tick.
  //
  // This sat unnoticed because no seeded template had subtasks until
  // migration 0034, so nothing ever called these endpoints.
  //
  // SubtaskCards reloads its own list and calls onChanged() straight after,
  // so nothing here goes stale.
  '/subtasks/',
];

export function shouldReloadFor(path: string): boolean {
  return !NO_RELOAD.some((p) => path.includes(p));
}

/** Last reload we asked for, as a guard against a runaway loop: if a
 *  page somehow issues a mutating request on mount, this stops the
 *  second reload rather than letting the tab spin. */
let lastReloadAt = 0;

export function reloadAfterAction(path: string): void {
  if (!shouldReloadFor(path)) return;
  const now = Date.now();
  if (now - lastReloadAt < 1500) return;
  lastReloadAt = now;

  rememberPlace();
  // A macrotask, so whatever the caller does in its own .then() — close a
  // dialog, clear a form, set a flag — has already run. None of it
  // survives the reload, but an exception thrown out of a half-finished
  // handler would, in the console, looking like a real fault.
  window.setTimeout(() => window.location.reload(), 0);
}

function rememberPlace(): void {
  try {
    const active = document.activeElement as HTMLElement | null;
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        url: window.location.pathname + window.location.search,
        scrollY: window.scrollY,
        /* The control that started this. Only useful when it has an id
           of its own; most buttons here do not, and for those the scroll
           position alone puts the person back in the right place. */
        focusId: active?.id || null,
        at: Date.now(),
      }),
    );
  } catch {
    // Private mode, or storage disabled. The reload still happens; it
    // just starts at the top of the page.
  }
}

/**
 * Put the page back where it was. Called once at boot.
 *
 * Restoring on load alone is not enough: every page here fetches its
 * data after mount, so at load the document is a skeleton a few hundred
 * pixels tall and scrolling to 2000 does nothing. This keeps trying
 * until the document is actually tall enough, then stops — and gives up
 * after a second rather than fighting a page that legitimately got
 * shorter.
 */
export function restorePlace(): void {
  let saved: { url: string; scrollY: number; focusId: string | null; at: number };
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    sessionStorage.removeItem(KEY);
    saved = JSON.parse(raw);
  } catch {
    return;
  }

  if (Date.now() - saved.at > FRESH_MS) return;
  if (saved.url !== window.location.pathname + window.location.search) return;
  if (saved.scrollY < 1 && !saved.focusId) return;

  const deadline = Date.now() + 1000;
  const tryRestore = () => {
    const el = saved.focusId ? document.getElementById(saved.focusId) : null;
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.focus({ preventScroll: true });
      return;
    }
    const reachable = document.documentElement.scrollHeight - window.innerHeight;
    if (reachable >= saved.scrollY) {
      window.scrollTo(0, saved.scrollY);
      return;
    }
    if (Date.now() < deadline) requestAnimationFrame(tryRestore);
  };
  requestAnimationFrame(tryRestore);
}
