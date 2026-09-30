import type { Config } from 'tailwindcss'
import forms from '@tailwindcss/forms'
import containerQueries from '@tailwindcss/container-queries'

// Mirrors the Tailwind config in ui.html (lines 19-61) verbatim.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ivory: {
          DEFAULT: '#FAF9F5',
          50: '#FFFFFF',
          100: '#FBFBF9',
          200: '#FAF9F5',
          300: '#EFECE4',
          400: '#E2DDCF',
          500: '#C8C2B0',
        },
        noir: {
          DEFAULT: '#0F0F0F',
          light: '#1A1A1A',
          surface: '#242424',
          border: '#2E2E2E',
        },
        gold: {
          DEFAULT: '#C9A45C',
          light: '#E5C77D',
          dark: '#9B7E3E',
          subtle: '#FAF6ED',
          glow: 'rgba(201, 164, 92, 0.18)',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        serif: ['Newsreader', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        subtle: '0 4px 20px -2px rgba(15, 15, 15, 0.05)',
        float: '0 24px 48px -12px rgba(15, 15, 15, 0.09)',
        'gold-subtle': '0 0 25px -4px rgba(201, 164, 92, 0.25)',
        card: '0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)',
      },
      keyframes: {
        scanSweep: {
          '0%': { top: '0%', opacity: '0' },
          '15%': { opacity: '1' },
          '85%': { opacity: '1' },
          '100%': { top: '100%', opacity: '0' },
        },
        chunkPulse: {
          '0%, 100%': {
            borderColor: 'rgba(201, 164, 92, 0.25)',
            backgroundColor: 'rgba(201, 164, 92, 0.04)',
          },
          '50%': {
            borderColor: 'rgba(201, 164, 92, 0.75)',
            backgroundColor: 'rgba(201, 164, 92, 0.12)',
          },
        },
      },
      animation: {
        scanSweep: 'scanSweep 4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        chunkPulse: 'chunkPulse 3s ease-in-out infinite',
      },
    },
  },
  plugins: [forms, containerQueries],
} satisfies Config
