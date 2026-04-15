import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#FAFAF8',
        'primary-text': '#0A0A0A',
        'secondary-text': '#6B6B6B',
        'tertiary-text': '#A8A8A4',
        border: '#E2E0DB',
        accent: '#C4A882',
        'overlay-dark': 'rgba(0,0,0,0.18)',
      },
      fontFamily: {
        pragmatica: ['Pragmatica', 'sans-serif'],
      },
      letterSpacing: {
        'hero': '0.10em',
        'nav': '0.22em',
        'label': '0.18em',
        'body': '0.12em',
        'button': '0.20em',
        'category': '0.25em',
        'meta': '0.10em',
      },
      fontSize: {
        'hero': ['clamp(48px,6vw,72px)', { lineHeight: '1.1' }],
        'section': ['clamp(28px,3vw,36px)', { lineHeight: '1.15' }],
      },
      transitionDuration: {
        '350': '350ms',
        '400': '400ms',
        '500': '500ms',
      },
      transitionTimingFunction: {
        'editorial': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      maxWidth: {
        'editorial': '1440px',
      },
    },
  },
  plugins: [],
}

export default config
