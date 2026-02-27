/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        light: {
          bg: '#fffdff',
          primary: '#004778',
          secondary: '#2c7ea3',
          accent: '#f19bbf',
        },
        dark: {
          bg: '#21180d',
          primary: '#f1f7e1',
          secondary: '#bbb098',
          accent: '#c06642',
        }
      }
    },
  },
  plugins: [],
}
