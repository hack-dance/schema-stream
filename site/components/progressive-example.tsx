"use client"

import { useReducedMotion } from "motion/react"
import { useEffect, useState } from "react"
import { SchemaStream, type SchemaStreamChunk } from "schema-stream"
import { z } from "zod"

const previewSchema = z.object({
  title: z.string(),
  summary: z.string(),
  metrics: z.object({ score: z.number() }),
  checks: z.array(z.object({ label: z.string(), state: z.string() }))
})

type PreviewSnapshot = SchemaStreamChunk<typeof previewSchema>

const FIXTURE: z.output<typeof previewSchema> = {
  checks: [{ label: "Support handoff", state: "watch" }],
  metrics: { score: 82 },
  summary: "One operational check remains.",
  title: "Release readiness"
}

const INITIAL_SNAPSHOT: PreviewSnapshot = {
  checks: [{ label: "", state: "" }],
  metrics: { score: null },
  summary: "",
  title: ""
}

function createCharacterStream({ delayMs }: { delayMs: number }): ReadableStream<string> {
  const serialized = JSON.stringify(FIXTURE)
  const chunks = delayMs === 0 ? [serialized] : Array.from(serialized)
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

export function ProgressiveExample() {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot>(INITIAL_SNAPSHOT)
  const [snapshotCount, setSnapshotCount] = useState(0)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    let cancelled = false
    let replayTimer: number | undefined

    function stopReplay(): void {
      cancelled = true
    }

    function startReplay(): void {
      replay().catch(stopReplay)
    }

    async function replay(): Promise<void> {
      setSnapshot(INITIAL_SNAPSHOT)
      setSnapshotCount(0)

      const parser = new SchemaStream(previewSchema, {
        defaultData: { checks: [{ label: "", state: "" }] },
        typeDefaults: { boolean: null, number: null, string: "" }
      })
      const source = createCharacterStream({ delayMs: reduceMotion ? 0 : 14 })

      for await (const nextSnapshot of parser.iterate(source, {
        snapshotPolicy: { mode: "chunk" },
        stringBufferSize: 0
      })) {
        if (cancelled) {
          return
        }
        setSnapshot(nextSnapshot)
        setSnapshotCount(current => current + 1)
      }

      if (!(cancelled || reduceMotion)) {
        replayTimer = window.setTimeout(startReplay, 900)
      }
    }

    startReplay()
    return () => {
      cancelled = true
      if (replayTimer !== undefined) {
        window.clearTimeout(replayTimer)
      }
    }
  }, [reduceMotion])

  return (
    <section
      aria-label="Progressively parsed schema-shaped JSON snapshot"
      className="progressive-example"
    >
      <div className="progressive-example-bar">
        <span>
          <span aria-hidden="true" className="status-dot" /> snapshot {snapshotCount}
        </span>
        <span>parsing every chunk</span>
      </div>
      <pre>
        <code>{JSON.stringify(snapshot, null, 2)}</code>
      </pre>
    </section>
  )
}
