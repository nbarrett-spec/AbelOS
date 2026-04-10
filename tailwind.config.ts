import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        abel: {
          navy: '#1B4F72',
          'navy-light': '#2471A3',
          'navy-dark': '#154360',
          orange: '#E67E22',
          'orange-light': '#F39C12',
          'orange-dark': '#D35400',
          green: '#27AE60',
          'green-light': '#2ECC71',
          slate: '#2C3E50',
          'slate-light': '#34495E',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config
