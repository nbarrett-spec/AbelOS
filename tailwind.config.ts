import type { Config } from 'tailwindcss'

/**
 * Aegis v3 — "Glass + Blueprint" Tailwind config
 * Colors reference CSS variables from globals.css. Three-layer tokens:
 *   Primitive  — gradient stops (c1-c4), blueprint (bp-*), legacy scales
 *   Semantic   — canvas, surface, fg, border, signal, data-*, forecast
 *   Component  — glass-card, bp-label, bp-dimension (defined in globals.css)
 *
 * Fonts: Outfit / Azeret Mono / Instrument Serif (Glass v3)
 *        Inter / JetBrains Mono / Playfair Display (data-design="drafting-room" escape hatch)
 */
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
        // ── Semantic (CSS vars — auto light/dark) ──────────────────────────
        canvas:           'var(--canvas)',
        surface:          'var(--surface)',
        'surface-muted':  'var(--surface-muted)',
        'surface-elev':   'var(--surface-elevated)',
        // Alias — many V5 sweep files use `surface-elevated` (the CSS var name)
        // instead of `surface-elev` (the Tailwind key). Wire both to the same var
        // so `bg-surface-elevated` / `border-surface-elevated` also compile.
        'surface-elevated': 'var(--surface-elevated)',
        'surface-floating': 'var(--surface-floating)',
        // Row hover — subtle gold tint applied on data-table `<tr>` + list `<li>`
        // hover. Agents across wave V5 wrote `hover:bg-row-hover`; give them a
        // real utility rather than a silent-no-style.
        'row-hover':      'rgba(198, 162, 78, 0.06)',
        border:           'var(--border)',
        'border-strong':  'var(--border-strong)',

        // ── Chart palette (aligns with globals.css --chart-1..6) ──────────
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
          6: 'var(--chart-6)',
        },
        fg: {
          DEFAULT:   'var(--fg)',
          muted:     'var(--fg-muted)',
          subtle:    'var(--fg-subtle)',
          inverse:   'var(--fg-inverse)',
          'on-accent':'var(--fg-on-accent)',
        },
        // Signal = primary interactive color (indigo in Glass / gold in Drafting Room)
        signal: {
          DEFAULT:   'var(--signal)',
          hover:     'var(--signal-hover)',
          subtle:    'var(--signal-subtle)',
          glow:      'var(--signal-glow)',
        },
        // Accent aliases (backward compat — maps to signal)
        accent: {
          DEFAULT:   'var(--accent)',
          hover:     'var(--accent-hover)',
          subtle:    'var(--accent-subtle)',
          fg:        'var(--accent-fg)',
        },
        brand: {
          DEFAULT:   'var(--brand)',
          hover:     'var(--brand-hover)',
          subtle:    'var(--brand-subtle)',
        },
        'data-positive': {
          DEFAULT: 'var(--data-positive)',
          bg:      'var(--data-positive-bg)',
          fg:      'var(--data-positive-fg)',
        },
        'data-negative': {
          DEFAULT: 'var(--data-negative)',
          bg:      'var(--data-negative-bg)',
          fg:      'var(--data-negative-fg)',
        },
        'data-warning': {
          DEFAULT: 'var(--data-warning)',
          bg:      'var(--data-warning-bg)',
          fg:      'var(--data-warning-fg)',
        },
        'data-info': {
          DEFAULT: 'var(--data-info)',
          bg:      'var(--data-info-bg)',
          fg:      'var(--data-info-fg)',
        },
        forecast: {
          DEFAULT: 'var(--forecast)',
          bg:      'var(--forecast-bg)',
          fg:      'var(--forecast-fg)',
        },

        // ── Glass v3 — gradient stops ────────────────────────────────────
        c1: 'var(--c1)',
        c2: 'var(--c2)',
        c3: 'var(--c3)',
        c4: 'var(--c4)',

        // ── Glass v3 — glass system ──────────────────────────────────────
        glass: {
          DEFAULT:  'var(--glass)',
          border:   'var(--glass-border)',
        },

        // ── Glass v3 — blueprint primitives ──────────────────────────────
        bp: {
          fine:       'var(--bp-fine)',
          major:      'var(--bp-major)',
          annotation: 'var(--bp-annotation)',
          redline:    'var(--bp-redline)',
        },

        // ── Legacy Drafting Room primitives ──────────────────────────────
        navy: {
          deep:  '#050d16',
          DEFAULT: '#0a1a28',
          mid:   '#132d42',
          light: '#1a3d56',
        },
        gold: {
          dark:    '#a88a3a',
          DEFAULT: '#c6a24e',
          light:   '#e4c77a',
        },
        cream: '#F3EAD8',
        mylar: '#f5f2eb',
        onion: '#f9f5ec',

        // ── Brand primitives (legacy-compatible) ──────────────────────────
        abel: {
          walnut:       '#3E2A1E',
          'walnut-light': '#5A4233',
          'walnut-dark':  '#2A1C14',
          amber:        '#C9822B',
          'amber-light':  '#D9993F',
          'amber-dark':   '#A86B1F',
          cream:        '#F3EAD8',
          'cream-dark':   '#E8DCCA',
          'kiln-oak':   '#8B6F47',
          sky:          '#8CA8B8',
          dust:         '#B8876B',
          brass:        '#8B6F2A',
          oxblood:      '#6E2A24',
          green:        '#2F7C3A',
          'green-light':  '#43994F',
        },

        // ── Walnut primitive scale ────────────────────────────────────────
        walnut: {
          50: '#F5EFE9', 100: '#E8D9C9', 200: '#C9A98C', 300: '#9C7A5C',
          400: '#6E543D', 500: '#5A4233', 600: '#3E2A1E', 700: '#2A1C14',
          800: '#1C120C', 900: '#0F0906',
        },

        // ── Amber primitive scale ─────────────────────────────────────────
        amber: {
          50: '#FDF6E8', 100: '#F9E4BB', 200: '#F3CC85', 300: '#E9AE4F',
          400: '#D9993F', 500: '#C9822B', 600: '#A86B1F', 700: '#865415',
          800: '#5E3A0E', 900: '#3A2408',
        },

        // ── Legacy semantic palettes (retained for existing references) ───
        success: {
          50: '#EEF7EF', 100: '#D4EBD6', 200: '#A7D6AB', 300: '#6FBA78',
          400: '#43994F', 500: '#2F7C3A', 600: '#23632C', 700: '#1A4B21',
          800: '#133618', 900: '#0B1F0E',
        },
        warning: {
          50: '#FDF6E8', 100: '#F9E4BB', 200: '#F3CC85', 300: '#E9AE4F',
          400: '#D9993F', 500: '#C9822B', 600: '#A86B1F', 700: '#865415',
          800: '#5E3A0E', 900: '#3A2408',
        },
        danger: {
          50: '#FAEEEB', 100: '#F1CFC6', 200: '#E3A495', 300: '#D07564',
          400: '#B64E3D', 500: '#9B3826', 600: '#7D2B1C', 700: '#5F2015',
          800: '#42160E', 900: '#260C07',
        },
        info: {
          50: '#EEF0F5', 100: '#D4D9E3', 200: '#A5AFC3', 300: '#76829F',
          400: '#54607D', 500: '#3E4861', 600: '#2E3649', 700: '#212638',
          800: '#161A27', 900: '#0C0E17',
        },
      },
      fontFamily: {
        sans:    ['var(--font-sans, Outfit)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono, Azeret Mono)', 'ui-monospace', 'monospace'],
        display: ['var(--font-display, Instrument Serif)', 'Georgia', 'serif'],
        numeric: ['var(--font-mono, Azeret Mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-2xl': ['3rem',    { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '600' }],
        'display-xl':  ['2.25rem', { lineHeight: '1.1',  letterSpacing: '-0.025em', fontWeight: '600' }],
        'display-lg':  ['1.875rem',{ lineHeight: '1.15', letterSpacing: '-0.02em',  fontWeight: '600' }],
        'h1':          ['1.5rem',  { lineHeight: '1.25', letterSpacing: '-0.015em', fontWeight: '600' }],
        'h2':          ['1.25rem', { lineHeight: '1.3',  letterSpacing: '-0.01em',  fontWeight: '600' }],
        'h3':          ['1rem',    { lineHeight: '1.4',  letterSpacing: '-0.005em', fontWeight: '600' }],
        'h4':          ['0.875rem',{ lineHeight: '1.4',  letterSpacing: '0em',      fontWeight: '600' }],
        'body-lg':     ['1rem',    { lineHeight: '1.55', letterSpacing: '0em' }],
        'body':        ['0.875rem',{ lineHeight: '1.55', letterSpacing: '0em' }],
        'body-sm':     ['0.8125rem',{ lineHeight: '1.5', letterSpacing: '0em' }],
        'caption':     ['0.75rem', { lineHeight: '1.4',  letterSpacing: '0.01em' }],
        'overline':    ['0.625rem',{ lineHeight: '1.4',  letterSpacing: '0.22em',  fontWeight: '600' }],
        'metric-xl':   ['2.25rem', { lineHeight: '1',    letterSpacing: '-0.02em',  fontWeight: '600' }],
        'metric-lg':   ['1.75rem', { lineHeight: '1',    letterSpacing: '-0.02em',  fontWeight: '600' }],
        'metric-hero': ['3rem',    { lineHeight: '1',    letterSpacing: '-0.03em',  fontWeight: '900' }],
      },
      spacing: {
        '4.5': '1.125rem',
        '13':  '3.25rem',
        '15':  '3.75rem',
        '18':  '4.5rem',
        '22':  '5.5rem',
      },
      borderRadius: {
        'xs':  '2px',
        'sm':  '4px',
        'md':  '6px',
        'lg':  '8px',
        'xl':  '12px',
        '2xl': '16px',
        '3xl': '24px',
        'pill':'9999px',
      },
      boxShadow: {
        'elevation-1': 'var(--elev-1)',
        'elevation-2': 'var(--elev-2)',
        'elevation-3': 'var(--elev-3)',
        'elevation-4': 'var(--elev-4)',
        'elevation-5': 'var(--elev-4)',
        'elevation-glow': 'var(--elev-glow)',
        // Two-layer elevation pattern (aligns with globals.css --elev-1..4)
        'elev-1': '0 1px 2px rgba(5, 13, 22, 0.20), 0 4px 12px rgba(5, 13, 22, 0.10)',
        'elev-2': '0 2px 4px rgba(5, 13, 22, 0.22), 0 8px 24px rgba(5, 13, 22, 0.14)',
        'elev-3': '0 4px 8px rgba(5, 13, 22, 0.25), 0 16px 40px rgba(5, 13, 22, 0.18)',
        'elev-4': '0 8px 16px rgba(5, 13, 22, 0.28), 0 24px 56px rgba(5, 13, 22, 0.22)',
        'inset-1':     'inset 0 1px 2px rgba(0, 0, 0, 0.08)',
        'glass':       'var(--glass-shadow)',
        'glass-hover': 'var(--glass-hover)',
        'glow-signal': '0 0 0 1px var(--signal), 0 0 20px var(--signal-subtle)',
        'glow-accent': '0 0 0 1px var(--accent), 0 0 20px var(--accent-subtle)',
        'glow-c1':     '0 0 0 2px var(--c1), 0 0 12px var(--signal-glow)',
      },
      backgroundImage: {
        'grad':      'var(--grad)',
        'grad-wide': 'var(--grad-wide)',
        'grad-subtle': 'var(--grad-subtle)',
      },
      transitionDuration: {
        'instant': '80ms',
        'fast':    '150ms',
        'base':    '200ms',
        'slow':    '320ms',
        'drawer':  '480ms',
        'scene':   '720ms',
      },
      transitionTimingFunction: {
        'house':  'cubic-bezier(.2, .8, .2, 1)',
        'draft':  'cubic-bezier(0.6, 0.1, 0.2, 1)',
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'press':  'cubic-bezier(0.22, 1.4, 0.36, 1)',
        'out':    'cubic-bezier(.2, .8, .2, 1)',
        'in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
      },
      keyframes: {
        shimmer:      { '0%': { backgroundPosition: '200% 0' }, '100%': { backgroundPosition: '-200% 0' } },
        'fade-in':    { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-up':   { '0%': { transform: 'translateY(6px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        'slide-down': { '0%': { transform: 'translateY(-6px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        'pulse-soft': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
        'signal-flash': { '0%': { backgroundColor: 'var(--signal-subtle)' }, '100%': { backgroundColor: 'transparent' } },
        'drawer-in':  { '0%': { opacity: '0', transform: 'translateX(100%)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        'stagger-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'bp-drift':   { '0%': { transform: 'translate(0, 0)' }, '100%': { transform: 'translate(60px, 60px)' } },
        'orb-float':  { '0%, 100%': { transform: 'translate(0, 0) scale(1)' }, '25%': { transform: 'translate(30px, -20px) scale(1.05)' }, '50%': { transform: 'translate(-10px, 15px) scale(0.95)' }, '75%': { transform: 'translate(-25px, -10px) scale(1.02)' } },
      },
      animation: {
        shimmer:      'shimmer 1.4s ease-in-out infinite',
        'fade-in':    'fade-in 200ms cubic-bezier(.2, .8, .2, 1) both',
        'slide-up':   'slide-up 200ms cubic-bezier(.2, .8, .2, 1) both',
        'slide-down': 'slide-down 200ms cubic-bezier(.2, .8, .2, 1) both',
        'pulse-soft': 'pulse-soft 2s cubic-bezier(0.65, 0, 0.35, 1) infinite',
        'signal-flash': 'signal-flash 180ms cubic-bezier(.2, .8, .2, 1) both',
        'drawer-in':  'drawer-in 480ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'stagger-up': 'stagger-up 400ms cubic-bezier(.2, .8, .2, 1) both',
        'bp-drift':   'bp-drift 60s linear infinite',
        'orb-float':  'orb-float 20s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
export default config
