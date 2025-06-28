/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
	theme: {
	  extend: {
		colors: {
		  'dark': {
			50: '#404040',
			100: '#2a2a2a',
			200: '#1a1a1a',
			300: '#0f0f0f',
			400: '#0a0a0a',
		  }
		},
		fontFamily: {
		  'mono': ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
		  'sans': ['Inter', 'system-ui', 'sans-serif'],
		},
		animation: {
		  'fade-in': 'fadeIn 0.8s ease-out',
		  'slide-up': 'slideUp 0.6s ease-out',
		},
		keyframes: {
		  fadeIn: {
			'0%': { opacity: '0' },
			'100%': { opacity: '1' },
		  },
		  slideUp: {
			'0%': { opacity: '0', transform: 'translateY(20px)' },
			'100%': { opacity: '1', transform: 'translateY(0)' },
		  },
		},
	  },
	},
	plugins: [],
  }