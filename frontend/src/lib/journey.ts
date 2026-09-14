/**
 * The five onboarding stages the horizontal JourneyTrack renders, keyed to
 * `onboardings.status`. Shared by Home and the Tasks page so the two can't
 * drift apart — they show the same track for the same employee.
 *
 * Note these are ONBOARDING stages, not task progress: an employee can sit at
 * 'active' (stage 4 of 5) with most of their tasks still outstanding. The two
 * measures answer different questions, which is why the Tasks header labels
 * them separately rather than implying one number.
 */
export const JOURNEY_STAGES = [
  { key: 'pre_onboarding', label: 'Pre-joining' },
  { key: 'email_provisioned', label: 'Email' },
  { key: 'checkpoint_pending', label: 'Checkpoint' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
];
