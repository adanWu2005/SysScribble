import type { Config } from 'tailwindcss';

const config: Config = {
  // The theme is a class on <html>, so a manual choice can override the system setting.
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand blue-violet. Every `indigo-*` class in the app now reads from this scale.
        indigo: {
          50: '#efeeff',
          100: '#e2e0ff',
          200: '#c8c4ff',
          300: '#a8a1ff',
          400: '#8278fb',
          500: '#5f52f3',
          600: '#4a3fe8',
          700: '#3b30cf',
          800: '#2f26a6',
          900: '#2812a8',
          950: '#170d5e',
        },
        // Cool, slightly violet greys, so surfaces and text sit well on the blue backdrop.
        neutral: {
          50: '#f7f7fd',
          100: '#efeff9',
          200: '#e2e2f1',
          300: '#cfcfe4',
          400: '#9d9dbd',
          500: '#706f95',
          600: '#55547c',
          700: '#3d3c64',
          800: '#2a2878',
          900: '#1c1563',
          950: '#120a47',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-rounded', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
