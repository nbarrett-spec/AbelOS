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
        // Semantic success palette (emerald-based)
        'success': {
          '50': '#f0fdf4',
          '100': '#dcfce7',
          '200': '#bbf7d0',
          '300': '#86efac',
          '400': '#4ade80',
          '500': '#22c55e',
          '600': '#16a34a',
          '700': '#15803d',
          '800': '#166534',
          '900': '#145231',
        },
        // Semantic warning palette (amber-based)
        'warning': {
          '50': '#fffbeb',
          '100': '#fef3c7',
          '200': '#fde68a',
          '300': '#fcd34d',
          '400': '#fbbf24',
          '500': '#f59e0b',
          '600': '#d97706',
          '700': '#b45309',
          '800': '#92400e',
          '900': '#78350f',
        },
        // Semantic danger palette (rose-based)
        'danger': {
          '50': '#fff5f5',
          '100': '#ffe0e0',
          '200': '#ffcccc',
          '300': '#ffa8a8',
          '400': '#ff6b6b',
          '500': '#ef4444',
          '600': '#dc2626',
          '700': '#b91c1c',
          '800': '#991b1b',
          '900': '#7f1d1d',
        },
        // Semantic info palette (sky-based)
        'info': {
          '50': '#f0f9ff',
          '100': '#e0f2fe',
          '200': '#bae6fd',
          '300': '#7dd3fc',
          '400': '#38bdf8',
          '500': '#0ea5e9',
          '600': '#0284c7',
          '700': '#0369a1',
          '800': '#075985',
          '900': '#0c3d66',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Display tier
        'display-2xl': ['3.5rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display-xl': ['3rem', { lineHeight: '1.15', letterSpacing: '-0.015em' }],
        'display-lg': ['2.5rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        // Heading tier
        'h1': ['2rem', { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '700' }],
        'h2': ['1.5rem', { lineHeight: '1.3', letterSpacing: '-0.005em', fontWeight: '700' }],
        'h3': ['1.25rem', { lineHeight: '1.35', letterSpacing: '0em', fontWeight: '600' }],
        'h4': ['1rem', { lineHeight: '1.4', letterSpacing: '0em', fontWeight: '600' }],
        // Body tier
        'body-lg': ['1.125rem', { lineHeight: '1.5', letterSpacing: '0em' }],
        'body': ['1rem', { lineHeight: '1.5', letterSpacing: '0em' }],
        'body-sm': ['0.875rem', { lineHeight: '1.5', letterSpacing: '0em' }],
        // Small tier
        'caption': ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.025em' }],
        'overline': ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.1em' }],
      },
      spacing: {
        '4.5': '1.125rem',
        '13': '3.25rem',
        '15': '3.75rem',
        '18': '4.5rem',
        '22': '5.5rem',
      },
      borderRadius: {
        'xs': '0.25rem',
        'sm': '0.375rem',
        'md': '0.5rem',
        'lg': '0.75rem',
        'xl': '1rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
        'pill': '9999px',
      },
      boxShadow: {
        'elevation-1': '0 1px 2px rgba(0, 0, 0, 0.08)',
        'elevation-2': '0 2px 4px rgba(0, 0, 0, 0.1)',
        'elevation-3': '0 4px 8px rgba(0, 0, 0, 0.12)',
        'elevation-4': '0 8px 16px rgba(0, 0, 0, 0.14)',
        'elevation-5': '0 16px 32px rgba(0, 0, 0, 0.16)',
        'inset-1': 'inset 0 1px 2px rgba(0, 0, 0, 0.08)',
        'glass': '0 8px 32px rgba(31, 38, 135, 0.15)',
        'glow-brand': '0 0 20px rgba(27, 79, 114, 0.2)',
      },
      transitionDuration: {
        'instant': '75ms',
        'fast': '150ms',
        'base': '250ms',
        'slow': '400ms',
        'slower': '600ms',
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'ease-out-expo': 'cubic-bezier(0.19, 1, 0.22, 1)',
        'ease-in-out-quart': 'cubic-bezier(0.77, 0, 0.175, 1)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-down': {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
        'glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(27, 79, 114, 0.2)' },
          '50%': { boxShadow: '0 0 30px rgba(27, 79, 114, 0.35)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s infinite',
        'fade-in': 'fade-in 500ms ease-out',
        'slide-up': 'slide-up 500ms ease-out',
        'slide-down': 'slide-down 500ms ease-out',
        'pulse-subtle': 'pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        glow: 'glow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
export default config
