import { ArrowUpRightIcon, TerminalIcon } from "lucide-react"
import type { Metadata } from "next"
import { SiteHeader } from "@/components/site-header"
import { loadLatestBenchmark } from "@/lib/benchmark-data"

export const metadata: Metadata = {
  description:
    "Reproducible Bun and Node.js evidence comparing serialized snapshot round trips with direct object snapshots from the same SchemaStream parser.",
  title: "Benchmarks"
}

function formatMilliseconds(value: number): string {
  return value < 10 ? value.toFixed(2) : value.toFixed(1)
}

function formatMebibytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}

export default async function BenchmarksPage() {
  const benchmark = await loadLatestBenchmark()
  const maximumSpeedup = Math.max(...benchmark.representativeRows.map(row => row.speedup))
  const minimumSpeedup = Math.min(...benchmark.representativeRows.map(row => row.speedup))

  return (
    <>
      <SiteHeader />
      <main className="benchmark-page content-page">
        <header className="content-header">
          <p className="section-label">Committed evidence</p>
          <h1>Benchmarks</h1>
          <p>
            This measures snapshot materialization inside the same SchemaStream parser workload. It
            is not a claim that SchemaStream is faster than standalone <code>JSON.parse</code> or
            <code>JSON.stringify</code>.
          </p>
          <div className="benchmark-command">
            <TerminalIcon aria-hidden="true" />
            <code>bun run benchmark</code>
          </div>
        </header>

        <section aria-labelledby="benchmark-comparison-title" className="benchmark-comparison">
          <div className="benchmark-comparison-intro">
            <p className="section-label">What is measured</p>
            <h2 id="benchmark-comparison-title">The same parser. One less JSON round trip.</h2>
            <p>
              Both paths parse the same input with the same snapshot policy. The benchmark changes
              only how each emitted snapshot becomes the object consumed by application code.
            </p>
          </div>
          <div className="benchmark-path-list">
            <div>
              <span>Serialized baseline</span>
              <code>
                parser snapshot → JSON.stringify → UTF-8 encode → decode → JSON.parse → object
              </code>
            </div>
            <div>
              <span>Direct candidate</span>
              <code>parser snapshot → direct object snapshot</code>
            </div>
            <p>
              Why it matters: frequent snapshots of a growing value repeatedly serialize, copy, and
              parse more bytes. Returning the independent object directly removes that CPU and
              allocation work. Provider latency, network transport, and standalone JSON operation
              speed are not measured here.
            </p>
          </div>
        </section>

        <section className="benchmark-summary">
          <div>
            <span>Largest measured round-trip removal</span>
            <strong>{maximumSpeedup.toFixed(2)}x</strong>
          </div>
          <div>
            <span>Fixture size</span>
            <strong>{benchmark.configuration.payloadSizeMiB} MiB</strong>
          </div>
          <div>
            <span>Recorded samples</span>
            <strong>{benchmark.configuration.repeats}</strong>
          </div>
          <div>
            <span>Host</span>
            <strong>{benchmark.host.chip}</strong>
          </div>
        </section>

        <section
          aria-label="Direct object snapshot speedup over the serialized snapshot round trip"
          className="benchmark-visualization"
        >
          {benchmark.representativeRows.map(row => (
            <div key={`${row.runtime}-${row.fixture}-${row.policy}`}>
              <div className="benchmark-row-label">
                <strong>{row.runtime.replace(" v", " ")}</strong>
                <span>
                  {row.fixture} / {row.policy}
                </span>
              </div>
              <div className="benchmark-track">
                <span style={{ width: `${Math.max(3, (row.speedup / maximumSpeedup) * 100)}%` }} />
              </div>
              <strong className="benchmark-speedup">{row.speedup.toFixed(2)}x</strong>
            </div>
          ))}
        </section>

        <div className="benchmark-table-wrap">
          <table className="benchmark-table">
            <thead>
              <tr>
                <th>Runtime</th>
                <th>Fixture</th>
                <th>Policy</th>
                <th>Serialized round trip</th>
                <th>Direct object snapshot</th>
                <th>Speedup</th>
                <th>Avoided bytes</th>
              </tr>
            </thead>
            <tbody>
              {benchmark.representativeRows.map(row => (
                <tr key={`${row.runtime}-${row.fixture}-${row.policy}-table`}>
                  <td>{row.runtime}</td>
                  <td>{row.fixture}</td>
                  <td>{row.policy}</td>
                  <td>{formatMilliseconds(row.roundtripMedianMs)} ms</td>
                  <td>{formatMilliseconds(row.iterateMedianMs)} ms</td>
                  <td>
                    <strong>{row.speedup.toFixed(2)}x</strong>
                  </td>
                  <td>{formatMebibytes(row.avoidedSerializedBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="benchmark-results-note">
          Every representative result stays visible, including near-parity cases as low as{" "}
          <strong>{minimumSpeedup.toFixed(2)}x</strong>. When parsing and schema materialization
          dominate a workload, removing the serialization round trip has a smaller effect.
        </p>

        <section className="method-grid">
          <div>
            <p className="section-label">Full method</p>
            <h2>Same inputs and policies. Only snapshot delivery changes.</h2>
          </div>
          <dl>
            <div>
              <dt>Baseline</dt>
              <dd>{benchmark.method.baseline}</dd>
            </div>
            <div>
              <dt>Candidate</dt>
              <dd>{benchmark.method.candidate}</dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd>{benchmark.method.resultValidation}</dd>
            </div>
            <div>
              <dt>Ordering</dt>
              <dd>{benchmark.method.sampleOrdering}</dd>
            </div>
          </dl>
        </section>

        <a className="evidence-link" href="/docs/snapshot-policies#benchmark">
          Benchmark methodology and CLI options <ArrowUpRightIcon aria-hidden="true" />
        </a>
      </main>
    </>
  )
}
