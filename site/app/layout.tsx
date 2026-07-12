import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"
import { RootProvider } from "fumadocs-ui/provider/next"
import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"
import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import { DESCRIPTION, SITE_URL } from "@/lib/site"
import "./global.css"

export const metadata: Metadata = {
  alternates: { canonical: SITE_URL },
  applicationName: "schema-stream",
  authors: [{ name: "Dimitri Kennedy", url: "https://hack.dance" }],
  creator: "Dimitri Kennedy",
  description: DESCRIPTION,
  keywords: [
    "streaming JSON",
    "structured output",
    "progressive JSON parser",
    "OpenAI Agents SDK",
    "Vercel AI SDK",
    "Mastra",
    "Zod",
    "Bun"
  ],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    description: DESCRIPTION,
    siteName: "schema-stream",
    title: "schema-stream",
    type: "website",
    url: SITE_URL
  },
  robots: { follow: true, index: true },
  title: {
    default: "schema-stream - Progressive typed JSON snapshots",
    template: "%s - schema-stream"
  },
  twitter: {
    card: "summary_large_image",
    description: DESCRIPTION,
    title: "schema-stream"
  }
}

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { color: "#ffffff", media: "(prefers-color-scheme: light)" },
    { color: "#0d0d0d", media: "(prefers-color-scheme: dark)" }
  ]
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <body>
        <RootProvider search={{ enabled: true }}>{children}</RootProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
