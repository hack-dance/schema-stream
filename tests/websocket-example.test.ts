import { expect, test } from "bun:test"
import { join } from "node:path"

const repositoryRoot = join(import.meta.dir, "..")
const port = 38_000 + (process.pid % 10_000)
const origin = `http://127.0.0.1:${port}`
const BunWebSocketClient = WebSocket as unknown as {
  new (url: string | URL, options?: Bun.WebSocketOptions): WebSocket
}

interface SessionResponse {
  token: string
}

interface CompleteMessage {
  output: {
    brief: string
  }
  snapshots: number
  type: "complete"
}

/** Starts the example without forwarding repository credentials to the child process. */
function startExampleServer(): Bun.Subprocess {
  return Bun.spawn([process.execPath, "examples/websocket-ui/server.ts"], {
    cwd: repositoryRoot,
    env: {
      HOME: process.env.HOME ?? "",
      PATH: process.env.PATH ?? "",
      SCHEMA_STREAM_EXAMPLE_PORT: String(port),
      TMPDIR: process.env.TMPDIR ?? "/tmp"
    },
    stderr: "pipe",
    stdout: "pipe"
  })
}

/** Waits for the bound loopback listener without assuming process startup timing. */
async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(origin)
      if (response.ok) {
        return
      }
    } catch {
      // The process has not bound its socket yet.
    }
    await Bun.sleep(25)
  }
  throw new Error("WebSocket example did not start")
}

/** Runs one capability-bound final-policy generation and records its decision branch. */
async function runFinalGeneration(token: string): Promise<{
  complete: CompleteMessage
  decision: boolean
}> {
  return await new Promise((resolve, reject) => {
    const socket = new BunWebSocketClient(
      `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`,
      { headers: { Origin: origin } }
    )
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error("WebSocket example generation timed out"))
    }, 10_000)
    let decision = false
    let completedMessage: CompleteMessage | undefined

    socket.addEventListener("error", () => {
      clearTimeout(timeout)
      reject(new Error("WebSocket example connection failed"))
    })
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>
      if (message.type === "hello") {
        socket.send(
          JSON.stringify({
            mode: "fixture",
            prompt: "Build the deterministic test dashboard.",
            snapshotPolicy: { mode: "final" },
            type: "start"
          })
        )
      } else if (message.type === "decision") {
        decision = true
      } else if (message.type === "error") {
        clearTimeout(timeout)
        socket.close()
        reject(new Error(`WebSocket example returned ${String(message.code)}`))
      } else if (message.type === "complete") {
        completedMessage = message as unknown as CompleteMessage
        setTimeout(() => {
          clearTimeout(timeout)
          socket.close()
          resolve({ complete: completedMessage as CompleteMessage, decision })
        }, 25)
      } else if (message.type === "status" && message.phase === "idle" && completedMessage) {
        clearTimeout(timeout)
        socket.close()
        reject(new Error("WebSocket example sent a redundant status after completion"))
      }
    })
  })
}

test("WebSocket example enforces its local capability boundary and completes a run", async () => {
  const server = startExampleServer()
  try {
    await waitForServer()

    const page = await fetch(origin)
    const html = await page.text()
    expect(html).toContain("Fixture")
    expect(html).toContain("OpenAI")
    expect(html).toContain("Fixture scenario")
    expect(html).not.toContain(">Demo<")
    expect(html).not.toContain(">Live<")

    const badHost = await fetch(origin, { headers: { Host: "attacker.test" } })
    expect(badHost.status).toBe(403)

    const sessionResponse = await fetch(`${origin}/session`)
    expect(sessionResponse.status).toBe(200)
    const session = (await sessionResponse.json()) as SessionResponse
    expect(session.token).toHaveLength(36)

    const wrongToken = await fetch(
      `${origin}/ws?token=${encodeURIComponent(`${session.token}x`)}`,
      {
        headers: { Origin: origin }
      }
    )
    expect(wrongToken.status).toBe(403)

    const missingOrigin = await fetch(`${origin}/ws?token=${encodeURIComponent(session.token)}`)
    expect(missingOrigin.status).toBe(403)
    const badOrigin = await fetch(`${origin}/ws?token=${encodeURIComponent(session.token)}`, {
      headers: { Origin: "http://attacker.test" }
    })
    expect(badOrigin.status).toBe(403)
    const validPreflight = await fetch(`${origin}/ws?token=${encodeURIComponent(session.token)}`, {
      headers: { Origin: origin }
    })
    expect(validPreflight.status).toBe(426)

    const result = await runFinalGeneration(session.token)
    expect(result.decision).toBe(true)
    expect(result.complete.snapshots).toBe(1)
    expect(result.complete.output.brief).toBe(
      "Customer-facing release with three open checks and an approval gate."
    )
  } finally {
    server.kill()
    await server.exited
  }
}, 20_000)
