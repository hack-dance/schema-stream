import { PlaygroundClient } from "@/components/playground-client"
import { SiteHeader } from "@/components/site-header"
import { createRouteMetadata } from "@/lib/metadata"

export const metadata = createRouteMetadata({
  description: "Compare SchemaStream snapshot policies against the same progressive JSON response.",
  path: "/playground",
  title: "Playground"
})

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
