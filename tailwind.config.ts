import type { Config } from 'tailwindcss'

/**
 * Design tokens mirror the Just A Second brand system (see
 * docs/just-website-repository-audit.md §2). Colors are read as `hsl(var(--token))`
 * so they track the CSS vars in app/globals.css and can be themed.
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1280px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-heebo)', 'Heebo', 'system-ui', 'sans-serif'],
        display: ['var(--font-heebo)', 'Heebo', 'system-ui', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Brand primitives (for gift-card artwork / decorative fills only).
        jas: {
          orange: '#E88225',
          'orange-2': '#C96A17',
          'orange-3': '#F4A866',
          cream: '#FFFCF5',
          'cream-2': '#F6F1E4',
          'cream-3': '#ECE5D1',
          sage: '#B5C9AD',
          'sage-2': '#D6E1CF',
          'sage-3': '#8FA688',
          slate: '#626B65',
          'slate-2': '#4A524D',
          forest: '#333D36',
        },
      },
      borderRadius: {
        sm: 'calc(var(--radius) - 6px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 8px)',
        '2xl': 'calc(var(--radius) + 18px)',
      },
      boxShadow: {
        'jas-1': '0 1px 2px rgba(51,61,54,.06)',
        'jas-2': '0 6px 16px -6px rgba(51,61,54,.16), 0 2px 4px rgba(51,61,54,.05)',
        'jas-3': '0 24px 40px -20px rgba(51,61,54,.25), 0 4px 10px rgba(51,61,54,.06)',
      },
      keyframes: {
        'mark-in': { from: { opacity: '0', transform: 'scale(.96)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'mark-in': 'mark-in .22s cubic-bezier(.2,.7,.2,1)',
        'fade-up': 'fade-up .32s cubic-bezier(.2,.7,.2,1)',
      },
    },
  },
  plugins: [],
}

export default config
