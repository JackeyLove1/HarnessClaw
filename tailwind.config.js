/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        notion: {
          white: '#ffffff',
          bg: '#ffffff',
          sidebar: '#f7f7f5',
          text: '#37352f',
          'text-secondary': 'rgba(55,53,47,0.5)',
          'text-tertiary': 'rgba(55,53,47,0.4)',
          border: '#e9e9e7',
          hover: '#efefed',
          'hover-secondary': '#e8e8e6',
          'drag-handle': '#dcdcdb',
          'scrollbar': '#dcdcdb',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        sans: [
          'MyriadPro-Regular',
          'MyriadPro-Light',
          '汉仪旗黑-55S',
          '汉仪旗黑-40S',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Microsoft YaHei',
          'Noto Sans SC',
          'sans-serif'
        ],
        brandEn: ['MyriadPro-Regular', 'MyriadPro-Light', '-apple-system', 'Segoe UI', 'sans-serif'],
        brandZh: ['汉仪旗黑-55S', '汉仪旗黑-40S', 'Microsoft YaHei', 'Noto Sans SC', 'sans-serif']
      },
      maxWidth: {
        'notion': '900px',
      },
      width: {
        'sidebar': '260px',
        'sidebar-min': '200px',
        'sidebar-max': '400px',
      },
      fontSize: {
        'notion-h1': ['40px', { lineHeight: '1.2', fontWeight: '700' }],
        'notion-h2': ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        'notion-h3': ['20px', { lineHeight: '1.4', fontWeight: '600' }],
      },
      spacing: {
        'notion': '90px',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    }
  },
  plugins: [require('@tailwindcss/typography')]
}
