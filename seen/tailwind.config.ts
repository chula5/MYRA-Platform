import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FBFAF7',
        ink: '#15150F',
        muted: '#6E6E63',
        rule: '#E2E0D8',
        accent: '#D93A16',
      },
      fontFamily: {
        sans: [
          'Helvetica Neue',
          'Helvetica',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Arial',
          'sans-serif',
        ],
      },
      letterSpacing: {
        tightest: '-0.045em',
      },
      maxWidth: {
        page: '1080px',
      },
    },
  },
  plugins: [],
};

export default config;
