/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'] },
      colors: {
        ink: { 950: '#161827', 900: '#202236', 800: '#30334d' },
        violetx: { 50: '#f4f1ff', 100: '#e9e3ff', 500: '#8066f6', 600: '#6e54ea', 700: '#5940d0' },
        mint: { 50: '#edfbf5', 500: '#21b887', 600: '#16976c' },
      },
      boxShadow: {
        panel: '0 12px 36px rgba(31, 36, 63, 0.07)',
        floating: '0 20px 60px rgba(24, 27, 51, 0.17)',
      },
      animation: { 'fade-up': 'fadeUp .28s ease-out', 'soft-pulse': 'softPulse 2.8s ease-in-out infinite' },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(7px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        softPulse: { '0%, 100%': { boxShadow: '0 0 0 0 rgba(128,102,246,.0)' }, '50%': { boxShadow: '0 0 0 8px rgba(128,102,246,.06)' } },
      },
    },
  },
  plugins: [],
};
