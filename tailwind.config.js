/** @type {import('tailwindcss').Config} */
module.exports = {
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
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
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
      }
    }
  },
  plugins: [require('@tailwindcss/typography')]
}
