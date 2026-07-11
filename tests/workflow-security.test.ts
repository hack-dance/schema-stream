import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const workflowDirectory = join(import.meta.dir, "..", ".github", "workflows")
const workflowNames = ["ci.yml", "publish.yml", "release-pr.yml"] as const
const actionReferencePattern = /^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm
const immutableActionReferencePattern = /^[^@\s]+@[0-9a-f]{40}$/
const pullRequestTriggerPattern = /^\s*pull_request:\s*$/m
const readOnlyPermissionsPattern = /^permissions:\n\s+contents: read$/m
const persistedCredentialsPattern = /persist-credentials: false/g
const publishEnvironmentPattern = /^\s+environment: PUBLISH$/m
const publishPermissionsPattern = /^\s+permissions:\n\s+contents: read\n\s+id-token: write$/m
const releasePermissionsPattern = /^permissions:\n\s+contents: write\n\s+pull-requests: write$/m

function readWorkflow(name: (typeof workflowNames)[number]): Promise<string> {
  return Bun.file(join(workflowDirectory, name)).text()
}

describe("GitHub Actions security", () => {
  test("pins every action to an immutable commit", async () => {
    for (const name of workflowNames) {
      const workflow = await readWorkflow(name)
      const actionReferences = [...workflow.matchAll(actionReferencePattern)]

      expect(actionReferences.length).toBeGreaterThan(0)
      for (const [, reference] of actionReferences) {
        expect(reference).toMatch(immutableActionReferencePattern)
      }
    }
  })

  test("keeps pull-request CI read-only and secret-free", async () => {
    const workflow = await readWorkflow("ci.yml")

    expect(workflow).toMatch(pullRequestTriggerPattern)
    expect(workflow).not.toContain("pull_request_target")
    expect(workflow).toMatch(readOnlyPermissionsPattern)
    expect(workflow).not.toContain("secrets.")
    expect(workflow.match(persistedCredentialsPattern)).toHaveLength(2)
  })

  test("limits trusted publishing to canonical release paths", async () => {
    const workflow = await readWorkflow("publish.yml")

    expect(workflow).toContain("github.repository == 'hack-dance/schema-stream'")
    expect(workflow).toContain("github.event.pull_request.merged == true")
    expect(workflow).toContain("github.base_ref == 'main'")
    expect(workflow).toContain("github.event.pull_request.head.repo.full_name == github.repository")
    expect(workflow).toContain("github.head_ref == 'changeset-release/main'")
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'")
    expect(workflow).toContain("github.ref == 'refs/heads/main'")
    expect(workflow).toMatch(publishEnvironmentPattern)
    expect(workflow).toMatch(publishPermissionsPattern)
    expect(workflow).toContain("persist-credentials: false")
    expect(workflow).not.toContain("contents: write")
    expect(workflow).not.toContain("NODE_AUTH_TOKEN")
    expect(workflow).not.toContain("NPM_TOKEN")
    expect(workflow).not.toContain("secrets.")
  })

  test("scopes release automation to the canonical repository", async () => {
    const workflow = await readWorkflow("release-pr.yml")

    expect(workflow).toContain("if: github.repository == 'hack-dance/schema-stream'")
    expect(workflow).toMatch(releasePermissionsPattern)
  })
})
