import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        xmit: {
          bg:      '#0a0a0f',
          surface: '#111118',
          border:  '#1e1e2e',
          accent:  '#6366f1',
          green:   '#22c55e',
          red:     '#ef4444',
          yellow:  '#eab308',
          cyan:    '#06b6d4',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
