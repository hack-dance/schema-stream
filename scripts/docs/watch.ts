import { stat } from "node:fs/promises"
import { relative } from "node:path"
import { repositoryRoot } from "./config"

const pollIntervalMs = 350
const maxRetryIntervalMs = 5000
const canonicalRootFiles = ["README.md", "CHANGELOG.md"] as const
const watchedGlobs = ["docs/**/*", "src/**/*.ts"] as const

function collectWatchedFiles(): string[] {
  const paths = canonicalRootFiles.map(path => `${repositoryRoot}/${path}`)
  for (const pattern of watchedGlobs) {
    const glob = new Bun.Glob(pattern)
    for (const path of glob.scanSync({ absolute: true, cwd: repositoryRoot, onlyFiles: true })) {
      paths.push(path)
    }
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right))
}

async function getSourceSignature(): Promise<string> {
  const paths = collectWatchedFiles()
  const entries = await Promise.all(
    paths.map(async path => {
      const metadata = await stat(path)
      return `${relative(repositoryRoot, path)}:${metadata.size}:${metadata.mtimeMs}`
    })
  )
  return entries.join("\n")
}

async function runScript(script: "docs:generate" | "docs:prepare"): Promise<void> {
  const child = Bun.spawn([process.execPath, "run", script], {
    cwd: repositoryRoot,
    stderr: "inherit",
    stdout: "inherit"
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(`${script} exited with code ${exitCode}`)
  }
}

type WatchState = {
  retryAfter: number
  retryIntervalMs: number
  signature: string
}

async function refreshChangedSources(state: WatchState): Promise<void> {
  if (Date.now() < state.retryAfter) {
    return
  }

  const nextSignature = await getSourceSignature()
  if (nextSignature === state.signature) {
    state.retryAfter = 0
    state.retryIntervalMs = pollIntervalMs
    return
  }

  console.info("Documentation watcher: source change detected")
  try {
    await runScript("docs:generate")
    await runScript("docs:prepare")
    const refreshedSignature = await getSourceSignature()
    if (refreshedSignature === nextSignature) {
      state.signature = refreshedSignature
      state.retryAfter = 0
      state.retryIntervalMs = pollIntervalMs
      console.info("Documentation watcher: staged content refreshed")
    } else {
      state.retryAfter = 0
      state.retryIntervalMs = pollIntervalMs
      console.info("Documentation watcher: sources changed during refresh; retrying")
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Documentation watcher: refresh failed: ${message}`)
    state.retryIntervalMs = Math.min(state.retryIntervalMs * 2, maxRetryIntervalMs)
    state.retryAfter = Date.now() + state.retryIntervalMs
  }
}

/** Polls canonical inputs and refreshes the ignored site staging tree after each coherent change. */
async function main(): Promise<void> {
  const state: WatchState = {
    retryAfter: 0,
    retryIntervalMs: pollIntervalMs,
    signature: await getSourceSignature()
  }
  let activeRefresh: Promise<void> | undefined
  console.info("Documentation watcher: canonical sources are synchronized")

  setInterval(() => {
    if (activeRefresh) {
      return
    }
    activeRefresh = refreshChangedSources(state)
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Documentation watcher: polling failed: ${message}`)
      })
      .finally(() => {
        activeRefresh = undefined
      })
  }, pollIntervalMs)
}

await main()
