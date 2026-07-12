import { ArrowRightIcon, GitForkIcon, PackageIcon, PlayIcon } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { CopyCommand } from "@/components/copy-command"
import { ProgressiveExample } from "@/components/progressive-example"
import { SiteHeader } from "@/components/site-header"
import { DESCRIPTION, GITHUB_URL, NPM_URL, SITE_URL } from "@/lib/site"

const integrations = [
  { href: "/docs/integrations/openai-agents", label: "OpenAI Agents SDK" },
  { href: "/docs/integrations/vercel-ai-sdk", label: "Vercel AI SDK" },
  { href: "/docs/integrations/mastra", label: "Mastra" },
  { href: "/docs/integrations/bun-websocket", label: "Bun WebSocket" }
] as const

export default function HomePage() {
  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    codeRepository: GITHUB_URL,
    description: DESCRIPTION,
    license: "https://opensource.org/license/mit",
    name: "schema-stream",
    programmingLanguage: "TypeScript",
    runtimePlatform: ["Bun", "Node.js"],
    url: SITE_URL
  }
  /** Prevent a future `<` in metadata from terminating the structured-data script element. */
  const softwareJsonLdText = JSON.stringify(softwareJsonLd).replaceAll("<", "\\u003c")

  return (
    <>
      <SiteHeader />
      <main>
        <section className="home-hero">
          <div className="home-hero-inner">
            <div className="home-kicker">Streaming structured output for TypeScript</div>
            <h1>schema-stream</h1>
            <p>{DESCRIPTION}</p>
            <div className="hero-actions">
              <Link className="primary-link" href="/docs">
                Read the docs <ArrowRightIcon aria-hidden="true" />
              </Link>
              <a className="text-link" href={GITHUB_URL} rel="noreferrer" target="_blank">
                <GitForkIcon aria-hidden="true" /> GitHub
              </a>
              <a className="text-link" href={NPM_URL} rel="noreferrer" target="_blank">
                <PackageIcon aria-hidden="true" /> npm
              </a>
            </div>
            <CopyCommand command="bun add schema-stream zod" />
            <ProgressiveExample />
          </div>
        </section>

        <section className="home-band" id="how-it-works">
          <div className="band-grid">
            <div>
              <p className="section-label">Why it exists</p>
              <h2>Use the fields that are ready. Keep streaming the rest.</h2>
            </div>
            <div className="ruled-list">
              <div>
                <span>01</span>
                <p>Accept arbitrary text and UTF-8 chunk boundaries from provider streams.</p>
              </div>
              <div>
                <span>02</span>
                <p>Materialize typed snapshots according to an explicit emission policy.</p>
              </div>
              <div>
                <span>03</span>
                <p>React once when nested keys or values complete, without rescanning the tree.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="home-band approach-teaser">
          <div className="band-grid">
            <div>
              <p className="section-label">Less repeated work</p>
              <h2>Keep parser state. Do not reparse the growing prefix.</h2>
              <p className="body-copy">
                SchemaStream consumes each incoming chunk against the parser state it already has.
                It materializes independent object snapshots only at the cadence your application
                chooses, then hands those objects directly to application code.
              </p>
              <div className="approach-paths">
                <code>provider chunk → SchemaStream.iterate() → typed object snapshot</code>
                <code>snapshotPolicy → control materialization and update frequency</code>
              </div>
              <Link className="inline-arrow" href="/approach">
                See how the approach works <ArrowRightIcon aria-hidden="true" />
              </Link>
            </div>
            <ol className="approach-flow">
              <li>
                <span>01</span>
                <div>
                  <strong>Arbitrary chunks arrive</strong>
                  <p>UTF-8, strings, tokens, and nested values may split anywhere.</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>State advances once</strong>
                  <p>The tokenizer and parser continue from the previous boundary.</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Your code receives an object</strong>
                  <p>Render a snapshot or react when a completed value matters.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className="home-band integrations-band">
          <div className="band-grid">
            <div>
              <p className="section-label">Integrations</p>
              <h2>One parser boundary. The SDK stays your choice.</h2>
            </div>
            <div className="integration-links">
              {integrations.map(integration => (
                <Link href={integration.href} key={integration.href}>
                  <span>{integration.label}</span>
                  <ArrowRightIcon aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="demo-band">
          <div className="demo-heading">
            <div>
              <p className="section-label">Progressive dashboard</p>
              <h2>See every policy shape the same response.</h2>
            </div>
            <Link className="primary-link" href="/playground">
              <PlayIcon aria-hidden="true" /> Open playground
            </Link>
          </div>
          <Image
            alt="SchemaStream progressively materializing a dashboard from JSON snapshots"
            className="demo-image"
            height={900}
            priority={false}
            src="/generated/schema-stream-demo.gif"
            unoptimized
            width={1600}
          />
        </section>
      </main>
      <footer className="site-footer">
        <span>schema-stream</span>
        <span>MIT licensed</span>
        <a href={GITHUB_URL}>Source on GitHub</a>
      </footer>
      <script type="application/ld+json">{softwareJsonLdText}</script>
    </>
  )
}
