import type { Config } from "tailwindcss";

const config: Omit<Config, "content"> = {
  darkMode: ["class"],
  theme: {
    container: {
      center: true,
      screens: {
        "sm": "100%",
        "md": "100%",
        "lg": "100%",
        "xl": "100%",
        "2xl": "1300px"
      }
    },
    extend: {
      fontFamily: {
        default: ["var(--font-default)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "serif"],
        inter: ["var(--font-inter)", "system-ui", "sans-serif"],

        mono: ["var(--font-default)", "monospace"],
        monoBold: ["var(--font-mono-bold)", "monospace"],

        okineBold: ["var(--font-okine-bold)"],
        okineBoldOutline: ["var(--font-okine-bold-outline)"],
        okineBlack: ["var(--font-okine-black)"],
        okineBlackOutline: ["var(--font-okine-black-outline)"],
        okine: ["var(--font-okine)"],
        okineMedium: ["var(--font-okine-medium)"],

        blunt: ["var(--font-blunt)"],
        bluntOutline: ["var(--font-blunt-outline)"]
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        link: "var(--colors-blue9)",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        }
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" }
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 }
        },
        "fade-in": {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 }
        }
      }
    },
    animation: {
      "accordion-down": "accordion-down 0.2s ease-out",
      "accordion-up": "accordion-up 0.2s ease-out",
      "spin-slow": "spin 3.5s linear infinite"
    }
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
    require("windy-radix-palette"),
    CustomGridPlugin
  ]
}
export default config;




function CustomGridPlugin({ addComponents }) {
  const components = {
    ".custom-grid": {
      "display": "grid",
      "gridAutoFlow": "dense",
      "padding": "0",
      "margin": "0",
      "gridTemplateColumns": "repeat(5, 1fr)",
      "width": "100%",
      "listStyleType": "none",
      "gap": "1rem",

      "& > li:nth-of-type(1n)": {
        "--span-x": "2",
        "--span-y": "2"
      },
      "& > li:nth-of-type(2n)": {
        "--span-x": "2.5",
        "--span-y": "2"
      },
      "& > li:nth-of-type(3n)": {
        "--span-x": "1",
        "--span-y": "1"
      },
      "& > li:nth-of-type(2n + 1)": {
        "--span-x": "2.5",
        "--span-y": "2"
      },
      "& > li:nth-of-type(3n + 1)": {
        "--span-x": "4",
        "--span-y": "1"
      },

      "& > li:nth-of-type(4n)": {
        "--span-x": "3",
        "--span-y": "1"
      },

      "& > li:nth-of-type(5n)": {
        "--span-x": "4",
        "--span-y": "2.5"
      },

      "& > li.grid-item.one-one": {
        "--span-x": "1",
        "--span-y": "1"
      },
      "& > li.grid-item.one-two": {
        "--span-x": "1",
        "--span-y": "2"
      },
      "& > li.grid-item.two-two": {
        "--span-x": "2",
        "--span-y": "2"
      },
      "& > li.grid-item.one-three": {
        "--span-x": "2",
        "--span-y": "3"
      },
      "& > li.grid-item.three-two": {
        "--span-x": "3",
        "--span-y": "2"
      },
      "& > li.grid-item.three-one": {
        "--span-x": "3",
        "--span-y": "1"
      },
      "& > li.grid-item.full": {
        "--span-x": "4",
        "--span-y": "4"
      },

      "& > li": {
        gridColumn: "span var(--span-x, 1)",
        gridRow: "span var(--span-y, 1)"
      },
      "& li > button": {
        "width": "100%",
        "height": "100%",
        "padding": "0",
        "cursor": "pointer",
        "border": "0",
        "borderRadius": "1rem",
        "animation": "enter both ease-in-out",
        "animationTimeline": "view()",
        "animationRange": "entry",
        "@keyframes enter": {
          from: {
            translate: "0 100%",
            scale: "0.25",
            opacity: "0.5"
          }
        },
        "@keyframes exit": {
          to: {
            translate: "0 -15vh",
            opacity: "0.5"
          }
        }
      }
    }
  }

  addComponents(components)
}
