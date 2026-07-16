/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f3f0ff',
          100: '#e9e4ff',
          200: '#d6ceff',
          300: '#b8a8ff',
          400: '#9b7eff',
          500: '#8c6dc4',
          600: '#6858a2',
          700: '#3d2b7a',
          800: '#2d1b6b',
          900: '#1a0e3d',
          950: '#0f0824',
        },
        accent: '#8c8ffe',
      },
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-dark':  'radial-gradient(ellipse at 50% 20%, #6858a2 0%, #3d2b7a 40%, #1a0e3d 100%)',
        'gradient-light': 'radial-gradient(ellipse at 50% 20%, #e9e4ff 0%, #d6ceff 40%, #f3f0ff 100%)',
      },
    },
  },
  plugins: [],
}
