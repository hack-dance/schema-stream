import Link from "next/link"
import { Box, Github, Twitter } from "lucide-react"

import { Footer } from "@/components/footer"
import { ScrollArea } from "@/components/ui/scroll-area"

export default async function Page() {
  return (
    <ScrollArea className="flex-1 h-[calc(100dvh-64px)]">
      <div className="h-full">
        <div className="px-6 sm:px-0 sm:container flex flex-col sm:items-center justify-center sm:mx-auto min-h-[calc(100dvh-64px)]">
          <h1 className="w-full sm:w-auto flex gap-2 sm:gap-6 font-blunt text-4xl sm:text-6xl">
            Schema Stream
          </h1>
          <p className="max-w-xl sm:text-center mt-4 mb-6">
            A JSON parser that can parse valid json from a stream and produce a safe-to-parse result
            based on the schema provided, allowing for access to the data while it is being parsed.{" "}
          </p>
          <div className="flex items-center mt-6 gap-4">
            <Link
              href="https://github.com/hack-dance/agents/tree/main/packages/core"
              target="_blank"
              className="text-foreground/50 hover:text-foreground"
            >
              <Github className="w-6 h-6" />
            </Link>
            <Link
              href="https://www.npmjs.com/package/@hackdance/agents"
              target="_blank"
              className="text-foreground/50 hover:text-foreground"
            >
              <Box className="w-6 h-6" />
            </Link>
            <Link
              href="https://twitter.com/dimitrikennedy"
              target="_blank"
              className="text-foreground/50 hover:text-foreground"
            >
              <Twitter className="w-6 h-6" />
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </ScrollArea>
  )
}
