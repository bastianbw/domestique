import type { Config } from 'tailwindcss';

// Race-roadbook / commissaire timing-sheet aesthetic.
// The four jersey colours are the ONLY accent palette and are used to ENCODE
// meaning (jersey holders, value heat) — never as decoration.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './engine/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // "night-before-the-stage" base
        ink: {
          900: '#0a0c0f',
          800: '#11151a',
          700: '#181d24',
          600: '#222933',
          500: '#2e3742',
          400: '#3c4856',
        },
        chalk: {
          100: '#f4f6f8',
          300: '#c4ccd6',
          500: '#8a95a3',
        },
        // jersey accents — meaning-encoding only
        yellow: { DEFAULT: '#f5d406' },
        green: { DEFAULT: '#19b35a' },
        polka: { DEFAULT: '#e23b3b' },
        white: { jersey: '#ffffff' },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
