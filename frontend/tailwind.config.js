/** @type {import('tailwindcss').Config} */
export default {
  // Only the files that actually use Tailwind. The rest of the app is
  // hand-written CSS in src/index.css and must stay that way.
  content: [
    './src/components/ui/**/*.{ts,tsx}',
    './src/components/MacBook*.{ts,tsx}',
    './src/pages/MacTools.tsx',
  ],
  corePlugins: {
    // Preflight resets margins, list styles, heading sizes and border
    // colours globally. src/index.css (~10k lines) is written against the
    // browser defaults, so turning it on would restyle the whole app.
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // The one amber from the design tokens at the top of index.css.
        accent: '#e88f30',
      },
    },
  },
  plugins: [],
};
