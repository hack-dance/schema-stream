import { ArrowRightIcon, GitForkIcon, PackageIcon, PlayIcon } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import type { CSSProperties } from "react"
import { CopyCommand } from "@/components/copy-command"
import { ProgressiveExample } from "@/components/progressive-example"
import { SiteHeader } from "@/components/site-header"
import { loadLatestBenchmark } from "@/lib/benchmark-data"
import { DESCRIPTION, GITHUB_URL, NPM_URL, SITE_URL } from "@/lib/site"

const integrations = [
  { href: "/docs/integrations/openai-agents", label: "OpenAI Agents SDK" },
  { href: "/docs/integrations/vercel-ai-sdk", label: "Vercel AI SDK" },
  { href: "/docs/integrations/mastra", label: "Mastra" },
  { href: "/docs/integrations/bun-websocket", label: "Bun WebSocket" }
] as const

export default async function HomePage() {
  const benchmark = await loadLatestBenchmark()
  const longStringChunkRows = benchmark.representativeRows.filter(
    row => row.fixture === "long-string" && row.policy === "chunk"
  )
  if (longStringChunkRows.length === 0) {
    throw new Error("Benchmark evidence needs a long-string chunk-policy result")
  }
  const directProfiles = longStringChunkRows.map(row => ({
    ...row,
    throughputMiBPerSecond: benchmark.configuration.payloadSizeMiB / (row.iterateMedianMs / 1000)
  }))
  const maximumThroughput = Math.max(...directProfiles.map(row => row.throughputMiBPerSecond))
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

        <section className="home-band benchmark-teaser">
          <div className="band-grid">
            <div>
              <p className="section-label">Measured hot path</p>
              <h2>Parse once. Hand application code an object.</h2>
              <p className="body-copy">
                <code>iterate()</code> accepts streaming text or bytes and yields independent,
                schema-shaped object snapshots. Application code can use each update immediately,
                without decoding and parsing its own snapshot first.
              </p>
              <div className="benchmark-paths">
                <code>provider chunk → SchemaStream.iterate() → typed object snapshot</code>
                <code>onValueComplete → conditional action while the root keeps streaming</code>
              </div>
              <p className="benchmark-caveat">
                Committed Apple M5 Max evidence uses a 2 MiB long-string fixture, 64 KiB source
                chunks, and five measured samples. It is a parser-path profile, not model or network
                latency and not a standalone JSON operation claim.
              </p>
              <Link className="inline-arrow" href="/benchmarks">
                Inspect all fixtures and methodology <ArrowRightIcon aria-hidden="true" />
              </Link>
            </div>
            <div
              aria-label="Measured source throughput of the direct object snapshot path"
              className="benchmark-bars"
              role="img"
            >
              {directProfiles.map(row => (
                <div key={row.runtime}>
                  <span>
                    {row.runtime} · {row.iterateMedianMs.toFixed(2)} ms median · long string / chunk
                  </span>
                  <div
                    style={
                      {
                        "--bar-size": `${Math.max(
                          10,
                          (row.throughputMiBPerSecond / maximumThroughput) * 100
                        )}%`
                      } as CSSProperties
                    }
                  >
                    {Math.round(row.throughputMiBPerSecond).toLocaleString("en-US")} MiB/s
                  </div>
                </div>
              ))}
            </div>
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
