/**
 * What a task actually asks of you, beyond its one-line description.
 *
 * The DB carries a title and a sentence per task, which is enough for HR to
 * see a pipeline but not enough for someone to act: "Install a Postgres client
 * of your choice" leaves a new joiner to work out which ones are acceptable,
 * where to get them, and what "configured with your company email" means.
 *
 * Keyed by title and matched loosely, exactly as POLICY_CONTENT in
 * pages/Documents.tsx is — same reasoning: the titles come from seeded
 * templates and are stable, and a task with no entry here (an ad-hoc one HR
 * scheduled) must still open and read well, so every consumer treats a miss
 * as "show the description alone" rather than as an error.
 *
 * Lives in data/ rather than in the popup because the trail's cards want the
 * step count too, and two components reading one map cannot disagree about
 * how many steps a task has.
 */

export interface TaskStep {
  title: string;
  detail?: string;
}

export interface TaskResource {
  label: string;
  href: string;
  /** Which platform or edition this link is for, when there is a choice. */
  note?: string;
}

export interface TaskGuide {
  /** Sits above the steps. Says why the task exists, which the title cannot. */
  summary: string;
  steps: TaskStep[];
  resources?: TaskResource[];
  /** One closing aside — the thing people get wrong, or ask afterwards. */
  tip?: string;
  /** The card face, when this guide is a checklist item rather than a task. */
  icon?: string;
  /**
   * An in-app destination, for items that point at a page we own rather than
   * at a vendor's download. Policies use this: the card opens the policy on
   * the Policies page instead of sending anyone to find it.
   */
  to?: string;
}

const TASK_GUIDES: Record<string, TaskGuide> = {
  'install vs code': {
    icon: '🧩',
    summary:
      'Visual Studio Code is the editor most teams here work in. Installing it under your company account means your settings and extensions follow you to any machine you sign in on.',
    steps: [
      {
        title: 'Download the build for your machine',
        detail:
          'On a company MacBook choose the Apple Silicon build unless IT told you otherwise — the Intel one runs, but slower.',
      },
      {
        title: 'Drag it to Applications and open it',
        detail:
          'macOS will ask once whether you are sure you want to open an app from the internet. You are.',
      },
      {
        title: 'Turn on Settings Sync with your company email',
        detail:
          'Bottom-left gear → Backup and Sync Settings → sign in with Microsoft, using your @andpayments address rather than a personal one.',
      },
      {
        title: 'Install the extensions your team uses',
        detail:
          'Ask your buddy which ones matter for your stack — it is a shorter list than the marketplace suggests.',
      },
    ],
    resources: [
      { label: 'Download VS Code', href: 'https://code.visualstudio.com/download', note: 'macOS, Windows, Linux' },
      { label: 'Getting started guide', href: 'https://code.visualstudio.com/docs', note: 'Official docs' },
    ],
    tip: 'Cmd+Shift+P opens the command palette. Almost everything VS Code can do is in there, and it is faster than hunting through menus.',
  },

  'install microsoft apps': {
    icon: '📊',
    summary:
      'Word, Excel, PowerPoint and Outlook install straight from the App Store on your Mac — no portal, no installer to hunt down, no key to enter. Teams is the one exception, and the steps say why.',
    steps: [
      {
        title: 'Open the App Store',
        detail:
          'It is in the Dock, or press ⌘ Space and type "App Store". Your own Apple ID is fine here — it has nothing to do with the company licence.',
      },
      {
        title: 'Get Word, Excel, PowerPoint and Outlook',
        detail:
          'Four separate downloads rather than one bundle, and each is free to install. The links below open the Mac version of each directly.',
      },
      {
        title: 'Install Teams from Microsoft',
        detail:
          'The only one not on the App Store — Microsoft does not publish it there. Use the Teams link below, and ignore App Store results like "Join for Teams": those are other companies\' apps, not Microsoft\'s.',
      },
      {
        title: 'Open Outlook and sign in with your work address',
        detail:
          'This is the step that turns the licence on — until you do it the apps open read-only. The first sync also pulls your calendar down, so give it a few minutes before you assume an invite is missing.',
      },
    ],
    resources: [
      { label: 'Microsoft Word', href: 'https://apps.apple.com/us/app/microsoft-word/id462054704?mt=12', note: 'Mac App Store' },
      { label: 'Microsoft Excel', href: 'https://apps.apple.com/us/app/microsoft-excel/id462058435?mt=12', note: 'Mac App Store' },
      { label: 'Microsoft PowerPoint', href: 'https://apps.apple.com/us/app/microsoft-powerpoint/id462062816?mt=12', note: 'Mac App Store' },
      { label: 'Microsoft Outlook', href: 'https://apps.apple.com/us/app/microsoft-outlook/id985367838?mt=12', note: 'Mac App Store' },
      { label: 'Download Teams', href: 'https://www.microsoft.com/en-us/microsoft-teams/download-app', note: 'Not on the App Store' },
    ],
    tip: 'Install Teams on your phone too. It is the fastest way for anyone to reach you on a day you are not at your desk.',
  },

  'install github': {
    icon: '🐙',
    summary:
      'Your code access runs through the company GitHub organisation. You need the tooling installed and your account added to the org before you can clone anything private.',
    steps: [
      {
        title: 'Install GitHub Desktop or the CLI',
        detail:
          'Desktop if you would rather see your changes; the CLI if you live in a terminal. Plenty of people here have both.',
      },
      {
        title: 'Sign in with the account your invite went to',
        detail:
          'If you already had a personal GitHub account, the org invite may have gone to your work address instead — check both inboxes.',
      },
      {
        title: 'Accept the organisation invitation',
        detail: 'Until you accept it, every private repository will look like it does not exist.',
      },
      {
        title: 'Clone something and confirm it works',
        detail:
          'Ask your buddy which repository to start with. A successful clone is how you know the access actually landed.',
      },
    ],
    resources: [
      { label: 'GitHub Desktop', href: 'https://desktop.github.com', note: 'macOS and Windows' },
      { label: 'GitHub CLI', href: 'https://cli.github.com', note: 'Terminal' },
    ],
    tip: 'No invitation after a day or two? It is usually an address mismatch rather than a missed step — tell HR which email your GitHub account uses.',
  },

  'install a postgres gui': {
    icon: '🐘',
    summary:
      'Postgres is the database behind most of what we run. A GUI client is how you read it without writing SQL by hand for every question — pick one, they all do the same job.',
    steps: [
      {
        title: 'Pick a client',
        detail:
          'TablePlus is the quickest to get on with, pgAdmin is the official one, DBeaver is free and handles other databases too.',
      },
      {
        title: 'Install it and open it once',
        detail: 'Just far enough to confirm it launches — you will not have a connection to point it at yet.',
      },
      {
        title: 'Ask your team for development credentials',
        detail:
          'Never connect a local client straight to a production database. Your team has a development instance for this.',
      },
      {
        title: 'Save the connection',
        detail:
          'Name it clearly enough that you can tell environments apart at a glance when there are three of them.',
      },
    ],
    resources: [
      { label: 'TablePlus', href: 'https://tableplus.com/download', note: 'Free tier available' },
      { label: 'pgAdmin', href: 'https://www.pgadmin.org/download/', note: 'Official, free' },
      { label: 'DBeaver', href: 'https://dbeaver.io/download/', note: 'Free, cross-database' },
    ],
    tip: 'Colour-code your saved connections if your client supports it. It is the cheapest possible guard against running something against the wrong environment.',
  },

  'install claude': {
    icon: '✨',
    summary:
      'Claude is available to everyone here for drafting, reviewing and working through problems. Sign in with your company address so your usage sits under the company workspace.',
    steps: [
      {
        title: 'Install the desktop app, or just use the browser',
        detail: 'Both work. The desktop app is easier to reach from a keyboard shortcut.',
      },
      {
        title: 'Sign in with your company email',
        detail:
          'A personal account will work but sits outside the company workspace, which is not where work belongs.',
      },
      {
        title: 'Read what you may and may not paste in',
        detail:
          'The Employee Handbook on your Policies page covers this. Customer data and credentials are the lines that matter.',
      },
    ],
    resources: [
      { label: 'Download Claude', href: 'https://claude.ai/download', note: 'macOS and Windows' },
      { label: 'Open Claude in the browser', href: 'https://claude.ai', note: 'No install needed' },
    ],
    tip: 'It is markedly better when you give it the surrounding context rather than a bare question — what you are building, what you already tried.',
  },

  'read the docs': {
    icon: '📚',
    summary:
      'The company policies worth knowing before you need them. Open a card to see what each one covers and to read it in full — tick it once you have.',
    /* Empty because the cards below carry the detail now. A list here would
       name the same policies immediately above themselves.

       The summary deliberately does not count them either: it said "Four
       policies" and was wrong the moment a fifth was published. Anything
       here that enumerates the checklist has to be maintained alongside it,
       so it is better to say nothing countable. */
    steps: [],
    tip: 'You do not need to memorise these. Knowing which document answers which question is the whole point.',
  },

  'meet your reporting manager': {
    icon: '🧭',
    summary:
      'Your first proper conversation with the person you report to. It sets the expectations you will be working against for the next few months, so it is worth arriving with questions.',
    steps: [
      { title: 'Get it in the calendar', detail: 'If nothing has appeared yet, send the invite yourself — nobody will mind.' },
      {
        title: 'Ask what good looks like in your first ninety days',
        detail: 'The most useful question you can ask, and the one people most often leave until too late.',
      },
      {
        title: 'Ask how they prefer to be reached',
        detail: 'Teams, email, or a standing slot — knowing this saves a lot of second-guessing later.',
      },
      { title: 'Agree how often you will talk', detail: 'A recurring one-to-one is easier to set up now than to ask for in a month.' },
    ],
    tip: 'Write down what you agree. A fortnight in, a surprising amount of this conversation will have blurred.',
  },

  'meet your onboarding buddy': {
    icon: '🤝',
    summary:
      'Someone outside your reporting line whose job is to answer the questions that feel too small to take to a manager. Use them for exactly that.',
    steps: [
      { title: 'Say hello and get something in the diary', detail: 'A coffee is plenty. This does not need an agenda.' },
      {
        title: 'Ask the unwritten things',
        detail: 'Which channels actually matter, who to ask about what, what the team is in the middle of.',
      },
      { title: 'Keep the thread open', detail: 'The value here is a month from now, when you hit something odd and want a quick read on it.' },
    ],
    tip: 'There is no such thing as too basic a question for a buddy. That is the entire reason the role exists.',
  },

  'company email & laptop handover': {
    icon: '💻',
    summary:
      'The checkpoint. IT hands over a provisioned laptop and your official company email, and the rest of your trail opens once both are confirmed working.',
    steps: [
      { title: 'Collect the laptop from IT', detail: 'They will walk you through the first sign-in and disk encryption.' },
      {
        title: 'Sign in to your company email',
        detail: 'Send one message to yourself. It is the quickest proof that both sending and receiving work.',
      },
      {
        title: 'Confirm it with IT',
        detail:
          'This step is closed by HR rather than by you — once they mark it done, the steps behind it unlock.',
      },
    ],
    tip: 'Something not working is worth raising immediately rather than working around. Everything after this step assumes both are in place.',
  },

  'register for office entry & exit access': {
    icon: '🪪',
    summary:
      'Facilities registers your badge or biometric access so you can get in and out of the building without someone letting you through each time.',
    steps: [
      { title: 'Visit the facilities desk', detail: 'Ground floor reception. Take a photo ID the first time.' },
      { title: 'Enrol your badge or fingerprint', detail: 'It takes a couple of minutes and is done on the spot.' },
      { title: 'Test it on the way out', detail: 'Far better to find a problem while the desk is still staffed.' },
    ],
    tip: 'Access sometimes takes a few hours to reach every door. If one reader refuses you on day one, try the main entrance before reporting it.',
  },

  /* --- The department tools, which only their own template seeds --- */

  'install your accounting system': {
    icon: '📒',
    summary:
      'The ledger the finance team works in. Your access is provisioned against your company email, so it has to be the address you sign in with.',
    steps: [
      { title: 'Wait for the access email', detail: 'Finance ops raise it once your company address exists. Ask if it has not arrived within a day.' },
      { title: 'Install the desktop client', detail: 'The download link is in that same email — it is version-matched to our instance.' },
      { title: 'Sign in and confirm your ledger view', detail: 'You should land on the current period. If you see nothing, your role has not been applied yet.' },
    ],
    tip: 'Do not export anything to a personal drive while you are finding your way around. The Employee Handbook covers what may leave the system.',
  },

  'install your ops scheduling tool': {
    icon: '🗓️',
    summary:
      'Where shifts, coverage and escalations are planned. Operations runs off it daily, so being in it is what makes you reachable.',
    steps: [
      { title: 'Accept the workspace invitation', detail: 'It goes to your company address once that is live.' },
      { title: 'Install the desktop and mobile apps', detail: 'Mobile matters here more than most tools — escalations do not wait for you to be at a desk.' },
      { title: 'Set your working hours and notifications', detail: 'The rota is built from what you set here, so a wrong timezone shows up as a missed shift.' },
    ],
    tip: 'Turn on push notifications on the phone app. It is the channel operations actually uses when something needs a person now.',
  },

  /* --- The policies, as checklist cards on "Read the docs" ---
     `to` sends each card to the Policies page with that policy already
     open, rather than dropping someone on a list of four and hoping. */

  'employee handbook': {
    icon: '📗',
    to: '/documents?policy=Employee%20Handbook',
    summary:
      'Working hours, leave, conduct, IT and security. The one to read properly rather than skim — most questions in your first month are answered in it.',
    steps: [
      { title: 'Working hours and flexibility', detail: 'Core hours, flexible timing, and how many days a week you can work from home.' },
      { title: 'Leave', detail: 'Casual, sick and earned leave, what carries over, and what needs a certificate.' },
      { title: 'Conduct and IT security', detail: 'The two sections with real consequences attached. Worth reading closely.' },
    ],
  },

  'group health insurance': {
    icon: '🩺',
    to: '/documents?policy=Group%20Health%20Insurance',
    summary:
      'Who is covered, for how much, and how a claim actually gets made. Read it before you need it — the waiting periods matter.',
    steps: [
      { title: 'Check who is covered', detail: 'Spouse, up to two children and parents are included from your joining date.' },
      { title: 'Note the cashless network', detail: 'Using a network hospital is the difference between cashless and claiming it back yourself.' },
      { title: 'Know the claim window', detail: 'Reimbursement claims go to HR within 15 days of discharge.' },
    ],
  },

  'meal reimbursement policy': {
    icon: '🍽️',
    to: '/documents?policy=Meal%20Reimbursement%20Policy',
    summary:
      'What the meal card covers, and what to do on a late shift, a client visit or a team outing.',
    steps: [
      { title: 'The monthly card', detail: 'Loaded by the 1st. Tax-exempt within the limits the policy sets out.' },
      { title: 'Late shifts and client meals', detail: 'Both are claimable, but they have different limits and need an itemised bill.' },
      { title: 'What not to double-claim', detail: 'Meals on a travel day sit under the travel allowance instead.' },
    ],
  },

  'domestic travel policy': {
    icon: '✈️',
    to: '/documents?policy=Domestic%20Travel%20Policy',
    summary:
      'Worth skimming now and returning to properly the first time you have a trip booked. Pre-approval is the step people miss.',
    steps: [
      { title: 'Get approval before booking', detail: 'Travel goes through your manager and the travel desk, in that order.' },
      { title: 'Know your city tier', detail: 'Hotel and daily allowance limits differ between metro and non-metro.' },
      { title: 'Keep local transport receipts', detail: 'The daily allowance needs none; anything claimed at actuals does.' },
    ],
  },

  'leave policy': {
    icon: '🌴',
    to: '/documents?policy=Leave%20Policy',
    summary:
      'What you get, how to ask for it, and what happens to what you do not use. Read it once now and you will not have to guess in March.',
    steps: [
      { title: 'Know your three balances', detail: 'Casual, sick and earned leave are separate, credited on different schedules, and do not substitute for each other.' },
      { title: 'Apply on the portal, always', detail: 'Including sick days, which you raise after the fact rather than before.' },
      { title: 'Watch the carry-forward', detail: 'Earned leave carries over up to a cap; casual leave and floaters do not carry at all.' },
    ],
  },

  'stealth mode policy': {
    icon: '🤫',
    to: '/documents?policy=Stealth%20Mode%20Policy',
    summary:
      'What can and cannot be said publicly about work that has not launched. Short, and the one policy where a mistake is hard to take back.',
    steps: [
      { title: 'Learn where the line sits', detail: 'If it is not on our website or in a press release, treat it as unreleased — including screenshots of internal tools.' },
      { title: 'Your profiles are fine', detail: 'Naming AND Payments and your role is encouraged. Describing the roadmap is not.' },
      { title: 'Check before pasting into AI tools', detail: 'Approved tools are listed on the IT portal. Ask IT before using a new one for work.' },
    ],
    tip: 'Ask before you post, not after. Nobody has ever been in trouble for asking.',
  },

  /* --- The two tasks that now carry checklists ---
     Short on purpose: the cards under them are where the substance is, and
     a long preamble above a checklist is just something to scroll past. */

  'install your software': {
    icon: '💾',
    summary:
      'Everything that needs to be on your machine, in one place. Open a card for what each one is and where to get it, then tick it off — this step closes itself once every app is ticked.',
    steps: [],
    tip: 'Do these on the company laptop rather than your own machine. Several of them license themselves off your company account.',
  },
};

/**
 * The guide for a task, matched the way policies are: exact title first, then
 * either direction of substring, then nothing. A miss is ordinary — ad-hoc
 * tasks HR schedules have no entry and are meant to fall back to their
 * description.
 */
export function taskGuideFor(title: string): TaskGuide | null {
  const key = title.trim().toLowerCase();
  if (TASK_GUIDES[key]) return TASK_GUIDES[key];
  for (const [k, v] of Object.entries(TASK_GUIDES)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}
