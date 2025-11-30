// tailwind.config.js

/** @type {import('tailwindcss').Config} */
module.exports = {
  // 1. Ensure your content paths are correct
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}', 
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}', // Add this line if you use a 'src' directory
  ],
  theme: {
    extend: {},
  },
  // 2. Add the typography plugin
  plugins: [
    require('@tailwindcss/typography'),
  ],
}