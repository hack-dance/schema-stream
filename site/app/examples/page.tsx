import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ArrowRightIcon, ExternalLinkIcon, TerminalSquareIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { CODESPACES_URL, examples } from "@/lib/examples"
import { REPOSITORY_ROOT } from "@/lib/repository"

export const metadata: Metadata = {
  description: "Runnable SchemaStream examples for Bun, OpenAI Agents, Vercel AI SDK, and Mastra.",
  title: "Examples"
}

function excerpt(source: string): string {
  const lines = source.split("\n")
  return lines.slice(0, 30).join("\n")
}

export default async function ExamplesPage() {
  const definitions = await Promise.all(
    examples.map(async example => ({
      ...example,
      source: excerpt(await readFile(join(REPOSITORY_ROOT, example.file), "utf8"))
    }))
  )

  return (
    <>
      <SiteHeader />
      <main className="examples-page content-page">
        <header className="examples-header content-header">
          <div>
            <p className="section-label">Executable source</p>
            <h1>Examples</h1>
            <p>
              The code shown here is read from the repository at build time. Fixture runs need no
              credentials; live provider runs keep keys inside your own development environment.
            </p>
          </div>
          <a className="primary-link" href={CODESPACES_URL} rel="noreferrer" target="_blank">
            <TerminalSquareIcon aria-hidden="true" /> Open full environment
          </a>
        </header>

        <div className="example-list">
          {definitions.map((example, index) => (
            <article className="example-row" key={example.file}>
              <div className="example-copy">
                <span className="example-index">{String(index + 1).padStart(2, "0")}</span>
                <h2>{example.title}</h2>
                <p>{example.description}</p>
                <div className="example-command">
                  <TerminalSquareIcon aria-hidden="true" />
                  <code>{example.command}</code>
                </div>
                <div className="example-links">
                  <Link href={example.docsHref}>
                    Read guide <ArrowRightIcon aria-hidden="true" />
                  </Link>
                  <a
                    href={`https://github.com/hack-dance/schema-stream/blob/main/${example.file}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Source <ExternalLinkIcon aria-hidden="true" />
                  </a>
                </div>
              </div>
              <pre>
                <code>{example.source}</code>
              </pre>
            </article>
          ))}
        </div>
      </main>
    </>
  )
}
