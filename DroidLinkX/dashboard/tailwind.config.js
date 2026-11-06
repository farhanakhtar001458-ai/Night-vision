/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#05070d',
          900: '#080b14',
          850: '#0b0f1a',
          800: '#0f1422',
          700: '#161d2f',
          600: '#1f2942',
        },
        brand: {
          50: '#eefbf7',
          100: '#d3f7ec',
          200: '#a9eedb',
          300: '#6fdfc5',
          400: '#35c8a9',
          500: '#16ad90',
          600: '#0b8a75',
          700: '#0b6e60',
          800: '#0d574d',
          900: '#0d4841',
        },
        accent: {
          400: '#7c8cff',
          500: '#5b6ef5',
          600: '#4652e0',
        },
      },
      fontFamily: {
        sans: ['"Inter var"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,255,255,0.04), 0 20px 60px -20px rgba(22,173,144,0.35)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 24px 60px -30px rgba(0,0,0,0.9)',
      },
      backgroundImage: {
        'grid-fade':
          'radial-gradient(circle at 20% -10%, rgba(22,173,144,0.16), transparent 45%), radial-gradient(circle at 90% 0%, rgba(91,110,245,0.16), transparent 40%)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(53,200,169,0.45)' },
          '70%': { boxShadow: '0 0 0 12px rgba(53,200,169,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(53,200,169,0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.8s infinite',
        pulseRing: 'pulseRing 2s infinite',
      },
    },
  },
  plugins: [],
};
