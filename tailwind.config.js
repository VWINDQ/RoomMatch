/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['IBM Plex Sans Thai', 'sans-serif'] },
      colors: {
        canvas: 'var(--background)', surface: 'var(--surface)', muted: 'var(--surface-muted)',
        primary: 'var(--primary)', deep: 'var(--primary-deep)', ink: 'var(--text-primary)',
        secondary: 'var(--text-secondary)', line: 'var(--border-soft)'
      }
    }
  },
  plugins: []
}
