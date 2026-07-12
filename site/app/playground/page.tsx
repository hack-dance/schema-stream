import type { Metadata } from "next"
import { PlaygroundClient } from "@/components/playground-client"
import { SiteHeader } from "@/components/site-header"

export const metadata: Metadata = {
  description: "Compare SchemaStream snapshot policies against the same progressive JSON response.",
  title: "Playground"
}

export default function PlaygroundPage() {
  return (
    <>
      <SiteHeader />
      <main className="playground-page">
        <PlaygroundClient />
      </main>
    </>
  )
}
