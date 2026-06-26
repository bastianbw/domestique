import type { Config } from 'tailwindcss';

// Refined "editorial" dark system. Deep neutral slate (never pure black),
// generous whitespace, ONE brand accent (Tour gold). Green/red are reserved
// strictly for +/- DKK semantics (data, not decoration), the jersey hues only
// ever encode a real jersey holder. Token NAMES are kept stable so every page
// re-skins from this one file.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './engine/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // deep neutral slate base → raised surfaces → hairline borders
        ink: {
          900: '#0d1117', // page
          850: '#11161d',
          800: '#161b22', // card surface
          700: '#1c222b', // raised / hover
          600: '#232a34', // soft divider
          500: '#2c3440', // border
          400: '#3a4452', // strong border
        },
        chalk: {
          100: '#e9edf2', // primary text
          200: '#cdd5de', // body text
          300: '#aab4c0', // secondary
          500: '#6f7a89', // muted / labels
        },
        // brand accent — used sparingly for interactive + brand
        gold: { DEFAULT: '#f2c100', soft: '#3a3206' },
        // jersey hues — encode meaning only
        yellow: { DEFAULT: '#f2c100' },
        green: { DEFAULT: '#2fa866' },
        polka: { DEFAULT: '#e5544b' },
        white: { jersey: '#ffffff' },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)',
        lift: '0 2px 4px rgba(0,0,0,0.45), 0 16px 40px -16px rgba(0,0,0,0.7)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s cubic-bezier(0.2,0.7,0.2,1) both',
      },
    },
  },
  plugins: [],
};

export default config;
