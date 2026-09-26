import { useMemo, useState } from 'react';
import type { PolicyQuiz as PolicyQuizData } from '../../data/policyQuizzes';
import { QUIZ_PASS_MARK } from '../../data/policyQuizzes';

/**
 * The comprehension quiz that gates ticking a policy off "Read the docs".
 *
 * Raised when the employee marks a policy complete: they answer five
 * questions and need QUIZ_PASS_MARK right to pass, at which point onPass runs
 * the actual completion. A fail can be retried — this is a check that the
 * policy was read, not an exam with one shot.
 *
 * `revealAnswers` shows the correct option on every question, as a testing
 * aid so the pass path can be walked without knowing the answers. It is a
 * prop rather than a build flag so it is obvious at the call site that it is
 * on, and obvious how to turn it off.
 */
export default function PolicyQuiz({
  quiz,
  revealAnswers = false,
  busy = false,
  onPass,
  onClose,
}: {
  quiz: PolicyQuizData;
  revealAnswers?: boolean;
  busy?: boolean;
  onPass: () => void;
  onClose: () => void;
}) {
  /** One entry per question, -1 until answered. */
  const [answers, setAnswers] = useState<number[]>(() => quiz.questions.map(() => -1));
  const [submitted, setSubmitted] = useState(false);

  const total = quiz.questions.length;
  const answeredCount = answers.filter((a) => a >= 0).length;
  const allAnswered = answeredCount === total;

  const score = useMemo(
    () => answers.reduce((n, a, i) => n + (a === quiz.questions[i].answer ? 1 : 0), 0),
    [answers, quiz.questions],
  );
  const passed = score >= QUIZ_PASS_MARK;

  function choose(qi: number, oi: number) {
    if (submitted) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[qi] = oi;
      return next;
    });
  }

  function retry() {
    setAnswers(quiz.questions.map(() => -1));
    setSubmitted(false);
  }

  return (
    <div className="quiz-overlay" onClick={onClose}>
      <div
        className="quiz"
        role="dialog"
        aria-modal="true"
        aria-label={`Quiz: ${quiz.title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="quiz__head">
          <div className="quiz__head-text">
            <span className="quiz__eyebrow">Quick check</span>
            <h2 className="quiz__title">{quiz.title}</h2>
            <p className="quiz__sub">
              Five questions — get {QUIZ_PASS_MARK} right to mark this read.
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close quiz"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {revealAnswers && !submitted && (
          <p className="quiz__testing">
            Testing mode — the correct answer is marked on each question.
          </p>
        )}

        {/* Progress dots, one per question, filled as they are answered and
            recoloured to right/wrong once submitted. */}
        <div className="quiz__dots" aria-hidden="true">
          {quiz.questions.map((q, i) => (
            <span
              key={i}
              className={[
                'quiz__dot',
                answers[i] >= 0 ? 'is-filled' : '',
                submitted ? (answers[i] === q.answer ? 'is-right' : 'is-wrong') : '',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </div>

        <div className="quiz__body">
          {quiz.questions.map((q, qi) => {
            const chosen = answers[qi];
            return (
              <fieldset key={qi} className="quiz__q">
                <legend className="quiz__q-prompt">
                  <span className="quiz__q-num">{qi + 1}</span>
                  {q.prompt}
                </legend>
                <div className="quiz__options">
                  {q.options.map((opt, oi) => {
                    const isChosen = chosen === oi;
                    const isCorrect = oi === q.answer;
                    const state = submitted
                      ? isCorrect
                        ? 'is-correct'
                        : isChosen
                          ? 'is-incorrect'
                          : ''
                      : isChosen
                        ? 'is-chosen'
                        : '';
                    return (
                      <button
                        type="button"
                        key={oi}
                        className={`quiz__opt ${state}`.trim()}
                        onClick={() => choose(qi, oi)}
                        disabled={submitted || busy}
                      >
                        <span className="quiz__opt-mark" aria-hidden="true" />
                        <span className="quiz__opt-label">{opt}</span>
                        {/* The testing reveal: a quiet tag on the right option,
                            before submission, so the pass path can be walked. */}
                        {revealAnswers && !submitted && isCorrect && (
                          <span className="quiz__opt-hint">answer</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>

        <footer className="quiz__foot">
          {submitted ? (
            <div className={`quiz__result ${passed ? 'is-pass' : 'is-fail'}`}>
              <div className="quiz__score">
                <strong>{score}</strong>
                <span>/ {total}</span>
              </div>
              <p className="quiz__result-msg">
                {passed
                  ? 'Passed — marking this policy read.'
                  : `Not quite — ${QUIZ_PASS_MARK} needed. Have another look and try again.`}
              </p>
              {passed ? (
                <button
                  type="button"
                  className="btn-solid"
                  disabled={busy}
                  onClick={onPass}
                >
                  {busy ? 'Saving…' : 'Continue'}
                </button>
              ) : (
                <button type="button" className="btn-solid" onClick={retry}>
                  Try again
                </button>
              )}
            </div>
          ) : (
            <>
              <span className="quiz__progress">
                {answeredCount} of {total} answered
              </span>
              <button
                type="button"
                className="btn-solid"
                disabled={!allAnswered || busy}
                title={allAnswered ? undefined : 'Answer every question first'}
                onClick={() => setSubmitted(true)}
              >
                Submit answers
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
