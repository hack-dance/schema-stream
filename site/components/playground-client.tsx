"use client"

import { track } from "@vercel/analytics"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  PlayIcon,
  RotateCcwIcon
} from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react"
import { SchemaStream, type SchemaStreamChunk, type SnapshotPolicy } from "schema-stream"
import { z } from "zod"

const dashboardSchema = z.object({
  title: z.string(),
  summary: z.string(),
  metrics: z.object({
    readiness: z.number(),
    risk: z.enum(["low", "medium", "high"]),
    coverage: z.number()
  }),
  milestones: z.array(
    z.object({
      complete: z.boolean(),
      label: z.string(),
      owner: z.string()
    })
  ),
  owners: z.record(
    z.string(),
    z.object({
      focus: z.string(),
      status: z.string()
    })
  ),
  recommendation: z.object({
    decision: z.enum(["ship", "hold"]),
    reason: z.string()
  })
})

type Dashboard = z.infer<typeof dashboardSchema>
type DashboardSnapshot = SchemaStreamChunk<typeof dashboardSchema>

const FIXTURE: Dashboard = {
  metrics: { coverage: 94, readiness: 82, risk: "medium" },
  milestones: [
    { complete: true, label: "API contract", owner: "Platform" },
    { complete: true, label: "Rollback plan", owner: "Reliability" },
    { complete: false, label: "Support handoff", owner: "Operations" }
  ],
  owners: {
    api: { focus: "Contract stability", status: "ready" },
    operations: { focus: "Escalation coverage", status: "review" },
    product: { focus: "Launch messaging", status: "ready" }
  },
  recommendation: {
    decision: "ship",
    reason: "Proceed after the support handoff owner confirms coverage."
  },
  summary: "The release is technically ready with one operational dependency still open.",
  title: "Release readiness"
}

const POLICIES = [
  { label: "Every character", policy: { mode: "chunk" } as const, value: "chunk" },
  { label: "Complete values", policy: { mode: "value" } as const, value: "value" },
  { label: "Every 96 bytes", policy: { bytes: 96, mode: "bytes" } as const, value: "bytes" },
  { label: "Final only", policy: { mode: "final" } as const, value: "final" }
] as const

interface CompletionEvent {
  id: number
  path: string
  value: string
}

function formatEventValue(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    return String(value)
  }
  return serialized.length > 62 ? `${serialized.slice(0, 59)}...` : serialized
}

function createCharacterStream({ delayMs }: { delayMs: number }): ReadableStream<string> {
  const chunks = Array.from(JSON.stringify(FIXTURE))
  let index = 0

  return new ReadableStream<string>({
    async pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }

      if (delayMs > 0) {
        await new Promise<void>(resolve => window.setTimeout(resolve, delayMs))
      }
      controller.enqueue(chunks[index])
      index += 1
    }
  })
}

function Metric({ label, value }: { label: string; value: null | number | string | undefined }) {
  return (
    <div className="playground-metric">
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  )
}

export function PlaygroundClient() {
  const [activePolicy, setActivePolicy] = useState("chunk")
  const [collapsedPanel, setCollapsedPanel] = useState<"events" | "json" | null>(null)
  const [decision, setDecision] = useState<string>()
  const [events, setEvents] = useState<CompletionEvent[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>({})
  const [snapshotCount, setSnapshotCount] = useState(0)
  const runId = useRef(0)
  const reduceMotion = useReducedMotion()

  const run = useCallback(
    async (policy: SnapshotPolicy): Promise<void> => {
      const currentRun = runId.current + 1
      runId.current = currentRun
      setDecision(undefined)
      setEvents([])
      setIsRunning(true)
      setSnapshot({})
      setSnapshotCount(0)

      let eventId = 0
      const parser = new SchemaStream(dashboardSchema, {
        onValueComplete({ path, value }) {
          if (runId.current !== currentRun) {
            return
          }

          eventId += 1
          const displayPath = path.length === 0 ? "$" : `$.${path.join(".")}`
          setEvents(current => [
            ...current.slice(-79),
            { id: eventId, path: displayPath, value: formatEventValue(value) }
          ])

          if (path.length === 2 && path[0] === "metrics" && path[1] === "risk") {
            setDecision(value === "high" ? "Hold for risk review" : "Continue release checks")
          }
        }
      })

      const delayMs = reduceMotion ? 0 : 6
      const source = createCharacterStream({ delayMs })

      for await (const nextSnapshot of parser.iterate(source, {
        snapshotPolicy: policy,
        stringBufferSize: 0
      })) {
        if (runId.current !== currentRun) {
          break
        }
        setSnapshot(nextSnapshot)
        setSnapshotCount(current => current + 1)
      }

      if (runId.current === currentRun) {
        setIsRunning(false)
      }
    },
    [reduceMotion]
  )

  const startRun = useCallback(
    (policy: SnapshotPolicy): void => {
      run(policy).catch(() => setIsRunning(false))
    },
    [run]
  )

  const selectPolicy = useCallback((event: MouseEvent<HTMLButtonElement>): void => {
    const value = event.currentTarget.dataset.policy
    const policy = POLICIES.find(item => item.value === value)
    if (!policy) {
      return
    }

    track("snapshot_policy_changed", { policy: policy.value })
    setActivePolicy(policy.value)
  }, [])

  const selected = POLICIES.find(item => item.value === activePolicy) ?? POLICIES[0]

  const replay = useCallback((): void => {
    startRun(selected.policy)
  }, [selected.policy, startRun])

  const toggleEvents = useCallback((): void => {
    setCollapsedPanel(value => (value === "events" ? null : "events"))
  }, [])

  const toggleJson = useCallback((): void => {
    setCollapsedPanel(value => (value === "json" ? null : "json"))
  }, [])

  useEffect(() => {
    startRun(selected.policy)

    return () => {
      runId.current += 1
    }
  }, [selected.policy, startRun])

  const json = JSON.stringify(snapshot, null, 2)
  const milestones = snapshot.milestones ?? []
  const owners = snapshot.owners ? Object.entries(snapshot.owners) : []

  return (
    <div className="playground-shell">
      <div className="playground-toolbar">
        <fieldset className="policy-control">
          <legend className="sr-only">Snapshot policy</legend>
          {POLICIES.map(item => (
            <button
              aria-pressed={activePolicy === item.value}
              data-policy={item.value}
              key={item.value}
              onClick={selectPolicy}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        <div className="run-status">
          <span className={isRunning ? "is-running" : "is-complete"}>
            {isRunning ? "Streaming" : "Complete"}
          </span>
          <span>{snapshotCount} snapshots</span>
          <button aria-label="Replay fixture" onClick={replay} title="Replay fixture" type="button">
            {isRunning ? <RotateCcwIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div className="playground-grid">
        <section aria-label="Materialized dashboard" className="materialized-dashboard">
          <div className="dashboard-heading">
            <motion.div animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 8 }}>
              <p className="section-label">Materialized dashboard</p>
              <h1>{snapshot.title ?? "Waiting for title"}</h1>
            </motion.div>
            {decision ? (
              <motion.div
                animate={{ opacity: 1, scale: 1 }}
                className="decision-signal"
                initial={{ opacity: 0, scale: 0.97 }}
              >
                <CircleCheckIcon aria-hidden="true" /> {decision}
              </motion.div>
            ) : null}
          </div>

          <p className="dashboard-summary">{snapshot.summary ?? "Summary is materializing..."}</p>

          <div className="playground-metrics">
            <Metric label="Readiness" value={snapshot.metrics?.readiness} />
            <Metric label="Coverage" value={snapshot.metrics?.coverage} />
            <Metric label="Risk" value={snapshot.metrics?.risk} />
          </div>

          <div className="dashboard-section">
            <div className="dashboard-section-heading">
              <h2>Milestones</h2>
              <span>{milestones.length} ready</span>
            </div>
            <div className="milestone-list">
              <AnimatePresence initial={false}>
                {milestones.map(milestone => (
                  <motion.div
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0, x: -8 }}
                    key={`${milestone.label}-${milestone.owner}`}
                    layout
                  >
                    <span className={milestone.complete ? "complete" : "pending"} />
                    <strong>{milestone.label}</strong>
                    <span>{milestone.owner}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="dashboard-section">
            <div className="dashboard-section-heading">
              <h2>Owners</h2>
              <span>{owners.length} materialized</span>
            </div>
            <div className="owner-grid">
              <AnimatePresence initial={false}>
                {owners.map(([owner, detail]) =>
                  detail ? (
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      initial={{ opacity: 0, y: 10 }}
                      key={owner}
                      layout
                    >
                      <span>{owner}</span>
                      <strong>{detail.focus}</strong>
                      <small>{detail.status}</small>
                    </motion.div>
                  ) : null
                )}
              </AnimatePresence>
            </div>
          </div>

          {snapshot.recommendation?.decision ? (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="recommendation"
              initial={{ opacity: 0, y: 12 }}
            >
              <span>{snapshot.recommendation.decision}</span>
              <p>{snapshot.recommendation.reason ?? "Reason is materializing..."}</p>
            </motion.div>
          ) : null}
        </section>

        <aside className={`inspector-panels collapsed-${collapsedPanel ?? "none"}`}>
          <section className="inspector-panel event-panel">
            <button
              aria-expanded={collapsedPanel !== "events"}
              className="inspector-heading"
              onClick={toggleEvents}
              type="button"
            >
              <span>Completion events</span>
              {collapsedPanel === "events" ? (
                <ChevronRightIcon aria-hidden="true" />
              ) : (
                <ChevronDownIcon aria-hidden="true" />
              )}
            </button>
            <div className="event-log">
              {events.map(event => (
                <div key={event.id}>
                  <span>{event.id}</span>
                  <code>{event.path}</code>
                  <small>{event.value}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="inspector-panel json-panel">
            <button
              aria-expanded={collapsedPanel !== "json"}
              className="inspector-heading"
              onClick={toggleJson}
              type="button"
            >
              <span>Current JSON snapshot</span>
              {collapsedPanel === "json" ? (
                <ChevronRightIcon aria-hidden="true" />
              ) : (
                <ChevronDownIcon aria-hidden="true" />
              )}
            </button>
            <pre aria-live="polite">
              <code>{json}</code>
            </pre>
          </section>
        </aside>
      </div>
    </div>
  )
}
