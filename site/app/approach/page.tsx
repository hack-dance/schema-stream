import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { createRouteMetadata } from "@/lib/metadata"

export const metadata = createRouteMetadata({
  description:
    "How SchemaStream incrementally parses provider output, controls snapshot cost, and hands complete object snapshots to application code.",
  path: "/approach",
  title: "Approach"
})

const stages = [
  {
    detail: "Text and UTF-8 chunks can split between bytes, tokens, keys, and nested values.",
    label: "Accept arbitrary boundaries"
  },
  {
    detail:
      "The tokenizer and parser resume from their existing state instead of rescanning input.",
    label: "Advance incremental state"
  },
  {
    detail: "The selected policy decides when a new independent, schema-shaped object is useful.",
    label: "Materialize deliberately"
  },
  {
    detail:
      "Application code receives an object; the producing SDK or application validates the final result.",
    label: "Consume and settle"
  }
] as const

export default function ApproachPage() {
  return (
    <>
      <SiteHeader />
      <main className="approach-page content-page">
        <header className="content-header">
          <p className="section-label">How and why</p>
          <h1>Incremental by design.</h1>
          <p>
            SchemaStream keeps parsing state across provider chunks and produces complete object
            snapshots at an explicit cadence. It is useful when structured fields should become
            available before the root JSON document closes.
          </p>
        </header>

        <section aria-labelledby="pipeline-title" className="approach-section">
          <div className="approach-section-copy">
            <p className="section-label">The pipeline</p>
            <h2 id="pipeline-title">Consume the stream once. Choose when to materialize.</h2>
            <p>
              Incremental parsing removes the need to retry a full parse from byte zero whenever a
              new chunk arrives. Snapshot policies keep that parser efficiency from being erased by
              materializing or transporting more updates than the interface needs.
            </p>
          </div>
          <ol className="approach-stage-list">
            {stages.map((stage, index) => (
              <li key={stage.label}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{stage.label}</strong>
                  <p>{stage.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="cost-title" className="approach-section">
          <div className="approach-section-copy">
            <p className="section-label">Cost model</p>
            <h2 id="cost-title">Cost follows payload shape and update cadence.</h2>
            <p>
              Incremental state avoids rescanning input the parser already consumed. Snapshot
              materialization, provider delay, transport, and rendering still scale with the
              workload, so choose a policy around the earliest update the consumer can use.
            </p>
          </div>
          <dl className="approach-decisions">
            <div>
              <dt>Parser state</dt>
              <dd>Carry it forward instead of reparsing an ever-growing prefix.</dd>
            </div>
            <div>
              <dt>Snapshots</dt>
              <dd>Use chunk, value, byte, or final policies to match the consumer.</dd>
            </div>
            <div>
              <dt>Completion</dt>
              <dd>React to a completed subtree without waiting for the root value.</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>Serialize once per selected revision and send complete application messages.</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="fit-title" className="approach-section">
          <div className="approach-section-copy">
            <p className="section-label">Where it fits</p>
            <h2 id="fit-title">Use it when progress has application value.</h2>
          </div>
          <div className="approach-fit">
            <div>
              <h3>Good fit</h3>
              <p>
                Structured model output, progressive dashboards, early routing decisions, nested
                completion events, or server-side fan-out to multiple browser clients.
              </p>
            </div>
            <div>
              <h3>Probably unnecessary</h3>
              <p>
                Small responses consumed only after completion, unstructured text, or workflows
                where no partial field can be used safely or meaningfully.
              </p>
            </div>
          </div>
        </section>

        <nav aria-label="Approach next steps" className="approach-links">
          <Link href="/docs/snapshot-policies">
            Choose a snapshot policy <ArrowRightIcon aria-hidden="true" />
          </Link>
          <Link href="/docs/transports">
            Design the server boundary <ArrowRightIcon aria-hidden="true" />
          </Link>
          <Link href="/playground">
            Compare policies visually <ArrowRightIcon aria-hidden="true" />
          </Link>
        </nav>
      </main>
    </>
  )
}
