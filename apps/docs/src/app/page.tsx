import Link from "next/link"

import { Footer } from "@/components/footer"
import { GlitchHeading } from "@/components/glitch-heading"
import { ScrollArea } from "@/components/ui/scroll-area"

export default async function Page() {
  return (
    <ScrollArea className="flex-1 h-[calc(100dvh-64px)]">
      <div className="h-full">
        <div className="px-6 sm:px-0 sm:container flex flex-col items-center justify-center sm:mx-auto min-h-[calc(100dvh-64px)]">
          <GlitchHeading glitchText="HACK" plainText="dance" />
          <p className="max-w-xl sm:text-center mt-4 mb-6">
            Description{" "}
            <Link href="https://novy.ai" target="_blank" className="underline">
              Novy.ai
            </Link>{" "}
          </p>
        </div>
      </div>
      <Footer />
    </ScrollArea>
  )
}
