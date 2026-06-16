import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        xaap: {
          red:    '#FF3B3B',
          orange: '#FF8C00',
          yellow: '#FFD700',
          green:  '#00C853',
          dim:    '#0A0A0F',
          surface:'#12121A',
          border: '#1E1E2E',
          muted:  '#6B6B8A',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
