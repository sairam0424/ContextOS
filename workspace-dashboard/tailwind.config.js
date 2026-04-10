/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0c1324',
        surface: 'rgba(12, 19, 36, 0.6)',
        'surface-bright': 'rgba(25, 31, 49, 0.8)',
        primary: '#00f0ff',
        secondary: '#a855f7',
        accent: '#ff0055',
        'text-dim': '#849495',
      },
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 20px rgba(0, 240, 255, 0.3)',
      }
    },
  },
  plugins: [],
}
