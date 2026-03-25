import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta Focus Club Vallecas — Dark Premium

        // Fondos
        obsidian: '#080808',
        carbon: '#080808',
        surface: '#0d0d0d',

        // Verdes
        'forest-deep': '#1B4332',
        'forest-700': '#1B4332',
        'forest-500': '#2D6A4F',
        emerald: {
          DEFAULT: '#2D6A4F',
          light: '#52b788',
          bright: '#74c69d',
          dark: '#1B4332',
        },

        // Texto
        ivory: {
          DEFAULT: '#f0f0f0',
          dark: '#d0d0d0',
        },

        // Glass
        glass: {
          bg: 'rgba(255, 255, 255, 0.03)',
          border: 'rgba(255, 255, 255, 0.07)',
          hover: 'rgba(82, 183, 136, 0.04)',
        },

        // Shadcn/ui bridge — sin hsl() wrapper (los vars contienen hex/rgba directos)
        background: 'var(--background)',
        foreground: 'var(--foreground)',

        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)'
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)'
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)'
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)'
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)'
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)'
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',

        chart: {
          '1': 'var(--chart-1)',
          '2': 'var(--chart-2)',
          '3': 'var(--chart-3)',
          '4': 'var(--chart-4)',
          '5': 'var(--chart-5)'
        },

        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)',
        },
      },

      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
        '3xl': 'calc(var(--radius) + 12px)',
      },

      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
      },

      boxShadow: {
        'glow': '0 0 40px rgba(82, 183, 136, 0.15), 0 0 80px rgba(82, 183, 136, 0.05)',
        'glow-lg': '0 0 60px rgba(82, 183, 136, 0.25), 0 0 120px rgba(82, 183, 136, 0.1)',
        'emerald-glow': '0 0 40px rgba(82, 183, 136, 0.2), 0 0 80px rgba(82, 183, 136, 0.08)',
        'emerald-glow-lg': '0 0 60px rgba(82, 183, 136, 0.3), 0 0 120px rgba(82, 183, 136, 0.12)',
        'card': '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
        'card-hover': '0 12px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      },

      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(135deg, rgba(82, 183, 136, 0.04) 0%, rgba(82, 183, 136, 0.02) 50%, rgba(82, 183, 136, 0.03) 100%)',
      },

      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
        'fade-up': 'fade-up 0.6s var(--easing-smooth) both',
        'scale-in': 'scale-in 0.5s var(--easing-smooth) both',
        'slide-in-right': 'slideInRight 0.5s ease-out forwards',
        'pulse-glow': 'glow-pulse 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },

      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(82, 183, 136, 0.4)' },
          '50%': { boxShadow: '0 0 20px rgba(82, 183, 136, 0.6), 0 0 40px rgba(82, 183, 136, 0.2)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },

      transitionTimingFunction: {
        'premium': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'smooth': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    }
  },
  plugins: [tailwindcssAnimate],
};

export default config;
