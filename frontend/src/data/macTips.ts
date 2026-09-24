export type MacTip = { icon: string; title: string; content: string };

/** The new-to-Mac tip sheet. Lives here rather than in either consumer
 *  because two of them render it now: the Mac Tools page, and the rail
 *  beside the employee's trail.
 *
 *  Ten, deliberately. On the Mac Tools page these lay out as five rows of
 *  cards inside a screen of fixed height, so the length of this list sets
 *  how much room each answer gets. Adding tips makes every card shorter;
 *  past a dozen or so the answers start being cut off. */
export const MAC_TIPS: MacTip[] = [
  { icon: '🔍', title: 'Spotlight search', content: 'Press Cmd+Space to instantly launch apps, find files, or do quick math — faster than digging through Finder.' },
  { icon: '🪟', title: 'Mission Control', content: 'Swipe up with three fingers (or press Control+Up) to see every open window and virtual desktop at once.' },
  { icon: '📋', title: 'Universal clipboard tricks', content: 'Cmd+C / Cmd+V work everywhere, and Cmd+Shift+4 grabs a screenshot of just the area you drag over.' },
  { icon: '🖱️', title: 'Trackpad gestures', content: 'Pinch to zoom, two-finger swipe to go back/forward in a browser, and a three-finger drag to move windows around.' },
  { icon: '🔒', title: 'Lock it fast', content: 'Cmd+Control+Q locks your screen instantly — good habit for the pantry coffee run.' },
  { icon: '🗂️', title: 'Quick Look', content: 'Select any file and hit Space to preview it without opening an app — works on PDFs, images, and more.' },
  { icon: '🛑', title: 'Force quit a frozen app', content: 'Cmd+Option+Esc opens the Force Quit window — pick the stuck app and end it without restarting your Mac.' },
  { icon: '😀', title: 'Emoji & symbols', content: 'Cmd+Control+Space opens the emoji picker from anywhere you can type, including Slack and email.' },
  { icon: '🪄', title: 'Split View', content: 'Hold the green full-screen button on any window to snap it to one side of the screen, then pick a second app for the other side.' },
  { icon: '📝', title: 'Quick Note', content: 'Swipe up from the bottom-right corner of the trackpad (or Fn+Q) to jot a note without opening an app.' },
];
