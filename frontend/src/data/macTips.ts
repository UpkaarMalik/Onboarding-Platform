export type MacTipCategory = 'Finding things' | 'Windows & spaces' | 'Capture' | 'Everyday';

export type MacTip = {
  icon: string;
  title: string;
  content: string;
  /**
   * The shortcut, one string per key cap, rendered as <kbd> rather than left
   * inside the sentence. A shortcut buried in prose ("press Cmd+Space to…")
   * has to be read before it can be found; as caps it can be scanned, which
   * is how a tip sheet actually gets used.
   *
   * Omitted where the tip is a gesture or a habit rather than a keystroke.
   */
  keys?: string[];
  /** The trackpad way, where there is one alongside (or instead of) the keys. */
  gesture?: string;
  category: MacTipCategory;
};

/** The new-to-Mac tip sheet, for the Mac Tools page.
 *
 *  Ten, deliberately. The page lays these out as five rows of cards inside a
 *  laptop screen of fixed height, so the length of this list sets how much
 *  room each answer gets — adding tips makes every card shorter, and past a
 *  dozen or so the answers start being cut off.
 *
 *  Keep `content` to roughly one line. It is the part that clips first. */
export const MAC_TIPS: MacTip[] = [
  {
    icon: '🔍',
    title: 'Spotlight search',
    content: 'Launch apps, find files, convert currency or do quick maths — without opening anything first.',
    keys: ['⌘', 'Space'],
    category: 'Finding things',
  },
  {
    icon: '🗂️',
    title: 'Quick Look',
    content: 'Preview any file — PDF, image, video — without waiting for an app to open it.',
    keys: ['Space'],
    category: 'Finding things',
  },
  {
    icon: '🪟',
    title: 'Mission Control',
    content: 'Every open window and desktop at once, so you can find the one you lost.',
    keys: ['Control', '↑'],
    gesture: 'Three fingers up',
    category: 'Windows & spaces',
  },
  {
    icon: '🪄',
    title: 'Split View',
    content: 'Snap a window to one half of the screen, then pick what fills the other.',
    gesture: 'Hold the green button',
    category: 'Windows & spaces',
  },
  {
    icon: '🖱️',
    title: 'Trackpad gestures',
    content: 'Two fingers go back and forward in a browser. Pinch to zoom. Three fingers change desktop.',
    gesture: 'Two and three fingers',
    category: 'Windows & spaces',
  },
  {
    icon: '📸',
    title: 'Screenshot an area',
    content: 'Drag over just the part you want — then tap Space to grab a whole window instead, shadow and all.',
    keys: ['⌘', '⇧', '4'],
    /* Space is a second press INSIDE the shortcut rather than part of it, so
       it is called out here instead of being added as a fourth cap — the caps
       are what you hold down together. */
    gesture: 'Then Space for a window',
    category: 'Capture',
  },
  {
    icon: '📝',
    title: 'Quick Note',
    content: 'Jot something down over whatever you are looking at, without leaving it.',
    keys: ['Fn', 'Q'],
    gesture: 'Swipe up from the bottom-right corner',
    category: 'Capture',
  },
  {
    icon: '😀',
    title: 'Emoji & symbols',
    content: 'The picker opens anywhere you can type — Teams, email, a commit message.',
    keys: ['⌘', 'Control', 'Space'],
    category: 'Everyday',
  },
  {
    icon: '🔒',
    title: 'Lock your screen',
    content: 'Worth making a reflex before every coffee run. Security will thank you.',
    keys: ['⌘', 'Control', 'Q'],
    category: 'Everyday',
  },
  {
    icon: '🛑',
    title: 'Force quit',
    content: 'Ends a frozen app without restarting the machine. Rarely needed, invaluable when it is.',
    keys: ['⌘', '⌥', 'Esc'],
    category: 'Everyday',
  },
];

/** The categories in display order, listed rather than derived so the page
 *  groups them in a deliberate sequence instead of first-seen order. */
export const MAC_TIP_CATEGORIES: MacTipCategory[] = [
  'Finding things',
  'Windows & spaces',
  'Capture',
  'Everyday',
];
