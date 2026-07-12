import { repositoryRoot } from "./config"

const children = [
  {
    command: [process.execPath, "scripts/docs/watch.ts"],
    name: "documentation watcher"
  },
  {
    command: [process.execPath, "run", "--cwd", "site", "dev"],
    name: "documentation site"
  }
].map(({ command, name }) => ({
  name,
  process: Bun.spawn(command, {
    cwd: repositoryRoot,
    stderr: "inherit",
    stdout: "inherit"
  })
}))

let stopRequested = false

function stopChildren(signal: NodeJS.Signals): void {
  stopRequested = true
  for (const child of children) {
    child.process.kill(signal)
  }
}

process.once("SIGINT", () => stopChildren("SIGINT"))
process.once("SIGTERM", () => stopChildren("SIGTERM"))

/** Keeps the docs watcher and Next development server in one cancellable process group. */
async function main(): Promise<void> {
  const firstExit = await Promise.race(
    children.map(async child => ({ child, exitCode: await child.process.exited }))
  )
  const requestedBeforeExit = stopRequested

  if (!requestedBeforeExit) {
    stopChildren("SIGTERM")
  }
  await Promise.allSettled(children.map(async child => await child.process.exited))

  if (!requestedBeforeExit && firstExit.exitCode !== 0) {
    throw new Error(`${firstExit.child.name} exited with code ${firstExit.exitCode}`)
  }
}

await main()
