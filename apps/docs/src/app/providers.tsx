"use client"

import { ThemeProvider } from "next-themes"

import { Toaster } from "@/components/ui/toaster"

export default function Providers({ children }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Toaster />
      {children}
    </ThemeProvider>
  )
}
