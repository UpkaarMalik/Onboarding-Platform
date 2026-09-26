/**
 * Short comprehension quizzes for the policy checklist on "Read the docs".
 *
 * One per policy, five questions each. Ticking a policy off requires passing
 * its quiz (4/5), so these have to be answerable from having actually read
 * the policy — every answer here is drawn from POLICY_CONTENT in
 * pages/Documents.tsx, not from general knowledge.
 *
 * Keyed by title and matched loosely, exactly as taskGuideFor and
 * POLICY_CONTENT are: the titles come from seeded rows and are stable, and a
 * policy with no quiz here simply completes without one rather than being
 * blocked.
 */

export interface QuizQuestion {
  prompt: string;
  options: string[];
  /** Index into `options`. */
  answer: number;
}

export interface PolicyQuiz {
  /** Shown at the top of the quiz so it is obvious which policy it is on. */
  title: string;
  questions: QuizQuestion[];
}

/** How many of the five must be right to pass. */
export const QUIZ_PASS_MARK = 4;

const QUIZZES: Record<string, PolicyQuiz> = {
  'employee handbook': {
    title: 'Employee Handbook',
    questions: [
      {
        prompt: 'What are the core hours everyone is expected to be available?',
        options: ['9:30 AM – 6:30 PM', '11 AM – 4 PM', '9 AM – 5 PM', 'There are none'],
        answer: 1,
      },
      {
        prompt: 'How many days a week can you work from home, with manager approval?',
        options: ['Up to 1', 'Up to 2', 'Up to 4', 'Fully remote'],
        answer: 1,
      },
      {
        prompt: 'A sick leave of how many consecutive days needs a medical certificate?',
        options: ['2 or more', '3 or more', '5 or more', 'Any at all'],
        answer: 1,
      },
      {
        prompt: 'What is the dress code Monday to Thursday?',
        options: ['Formal', 'Business casual', 'Anything goes', 'Uniform'],
        answer: 1,
      },
      {
        prompt: 'How can a grievance be raised?',
        options: [
          'Only in person to your manager',
          'Anonymously via the Ethics Hotline',
          'It cannot be',
          'Only in writing to the CEO',
        ],
        answer: 1,
      },
    ],
  },

  'group health insurance': {
    title: 'Group Health Insurance',
    questions: [
      {
        prompt: 'Who is covered from your date of joining?',
        options: [
          'Only you',
          'You and your spouse only',
          'You, spouse, up to 2 children and parents',
          'Nobody until probation ends',
        ],
        answer: 2,
      },
      {
        prompt: 'What is the base sum insured per family per year?',
        options: ['₹5,00,000', '₹10,00,000', '₹1,00,000', '₹25,00,000'],
        answer: 1,
      },
      {
        prompt: 'For cashless treatment, where must you go?',
        options: [
          'Any hospital at all',
          'A hospital on the insurer network list',
          'Only the company clinic',
          'Government hospitals only',
        ],
        answer: 1,
      },
      {
        prompt: 'How long do you have to submit a reimbursement claim after discharge?',
        options: ['48 hours', '7 days', '15 days', '90 days'],
        answer: 2,
      },
      {
        prompt: 'When does maternity cover become available?',
        options: [
          'Immediately on joining',
          'After 9 months of continuous employment',
          'After 2 years',
          'It is not covered',
        ],
        answer: 1,
      },
    ],
  },

  'meal reimbursement policy': {
    title: 'Meal Reimbursement Policy',
    questions: [
      {
        prompt: 'By when is the monthly meal card loaded?',
        options: ['The 1st of the month', 'The 15th', 'The last day', 'On request only'],
        answer: 0,
      },
      {
        prompt: 'What is claimable for a late shift, and past what time?',
        options: [
          '₹350 for dinner, past 8:30 PM',
          '₹1,000 any time',
          'Nothing',
          '₹350, past 6 PM',
        ],
        answer: 0,
      },
      {
        prompt: 'For a client-visit meal, what must you submit?',
        options: [
          'Just the card slip',
          'An itemised bill within 7 days',
          'Nothing, it is automatic',
          'A manager email only',
        ],
        answer: 1,
      },
      {
        prompt: 'What must you NOT do for meals on a travel day?',
        options: [
          'Claim anything at all',
          'Double-claim meal reimbursement and travel allowance',
          'Use the meal card',
          'Eat at the hotel',
        ],
        answer: 1,
      },
      {
        prompt: 'Is alcohol reimbursable on a team outing?',
        options: ['Yes, always', 'No', 'Only at year-end', 'Only with VP sign-off'],
        answer: 1,
      },
    ],
  },

  'domestic travel policy': {
    title: 'Domestic Travel Policy',
    questions: [
      {
        prompt: 'What must happen before you book any travel?',
        options: [
          'Nothing, book freely',
          'Pre-approval by your reporting manager',
          'Payment upfront by you',
          'A form to Finance after the trip',
        ],
        answer: 1,
      },
      {
        prompt: 'Which class of flight is standard for all employees?',
        options: ['Business', 'Economy', 'First', 'Premium economy'],
        answer: 1,
      },
      {
        prompt: 'How far in advance should flights be booked?',
        options: ['Same day is fine', 'At least 7 days', 'At least 30 days', 'No rule'],
        answer: 1,
      },
      {
        prompt: 'What is the hotel limit in a metro city?',
        options: ['₹3,500/night', '₹5,000/night', '₹10,000/night', 'No limit'],
        answer: 1,
      },
      {
        prompt: 'Does the daily allowance need receipts?',
        options: [
          'Yes, for everything',
          'No — it is a per-diem claimed on the portal',
          'Only for meals',
          'Only over ₹500',
        ],
        answer: 1,
      },
    ],
  },

  'leave policy': {
    title: 'Leave Policy',
    questions: [
      {
        prompt: 'How many casual leave days do you get a year?',
        options: ['8', '12', '15', '26'],
        answer: 1,
      },
      {
        prompt: 'How much earned leave can carry forward to the next year?',
        options: ['None', 'Up to 15 days', 'Up to 30 days', 'Unlimited'],
        answer: 2,
      },
      {
        prompt: 'How should every leave — including sick days — be recorded?',
        options: [
          'A message to your manager',
          'Raised on the HR portal',
          'It does not need recording',
          'An email to HR',
        ],
        answer: 1,
      },
      {
        prompt: 'How many public holidays and floaters are there?',
        options: [
          '10 fixed + 2 floaters',
          '12 fixed, no floaters',
          '8 fixed + 4 floaters',
          '15 fixed',
        ],
        answer: 0,
      },
      {
        prompt: 'What happens to leave taken beyond your balance?',
        options: [
          'It is refused outright',
          'It is unpaid and needs HR approval in advance',
          'It is paid as normal',
          'It is deducted from next year',
        ],
        answer: 1,
      },
    ],
  },

  'stealth mode policy': {
    title: 'Stealth Mode Policy',
    questions: [
      {
        prompt: 'What counts as "unreleased" and must be kept private?',
        options: [
          'Only unannounced products',
          'Anything not on our website or in a press release',
          'Nothing once you have signed your contract',
          'Only client names',
        ],
        answer: 1,
      },
      {
        prompt: 'On your own social profiles, what is fine to share?',
        options: [
          'The roadmap and what ships next',
          'That you work at AND Payments and your role',
          'Screenshots of internal tools',
          'Client names you work with',
        ],
        answer: 1,
      },
      {
        prompt: 'Before pasting work into a new AI tool, you should…',
        options: [
          'Just use it',
          'Check it is approved on the IT portal / ask IT',
          'Ask a teammate',
          'Nothing — all tools are fine',
        ],
        answer: 1,
      },
      {
        prompt: 'Who announces a launch, and when can you share it freely?',
        options: [
          'Anyone, any time',
          'Marketing, once it is out',
          'Engineering, at code freeze',
          'It can never be shared',
        ],
        answer: 1,
      },
      {
        prompt: 'If you are unsure whether something can be shared, you should…',
        options: [
          'Post it and see',
          'Ask before you post — your manager, Marketing or legal',
          'Assume it is fine',
          'Never mention the company',
        ],
        answer: 1,
      },
    ],
  },
};

/** Loose lookup, same normalisation as taskGuideFor / policySectionsFor. */
export function quizFor(title: string): PolicyQuiz | null {
  const key = title.trim().toLowerCase();
  if (QUIZZES[key]) return QUIZZES[key];
  for (const [k, v] of Object.entries(QUIZZES)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}
