# island-ai follow-up

This is the small follow-up to make `hack-dance/schema-stream` canonical after the dedicated
repository migration merges and `schema-stream@4.0.1` is available on npm.

Do this in a separate island-ai branch or worktree. Do not combine it with the extraction PR.

## Required patch

1. Delete `public-packages/schemaStream/` from island-ai. Its source, package manifest, tests, and
   changelog now live in the dedicated repository.
2. Regenerate `bun.lock` after the deletion. `public-packages/zod-stream/package.json` already uses
   the registry-compatible dependency `"schema-stream": "^4.0.0"`; optionally raise that floor to
   `^4.0.1` when the metadata patch is published.
3. Move the schema-stream-only packed fixtures (`consumer-zod3.ts` and its tsconfig) out of
   `tests/packed-consumer/`; their coverage now lives here. Keep zod-stream and stream-hooks consumer
   coverage, but install `schema-stream@^4.0.1` from npm instead of copying a workspace package into
   the temporary pack directory.
4. Replace island-ai's schema-stream package/docs landing pages with a short archived notice linking
   to <https://github.com/hack-dance/schema-stream>. Keep historical changelog references intact.
5. Remove any schema-stream entry from island-ai's Changesets package inventory or release docs. No
   dependent package version bump is needed unless a dependency range or published package content
   changes.

## Safety sequence

The dependency edge is already safe: published `zod-stream@4.0.0` depends on
`schema-stream@^4.0.0`, not `workspace:*`. Still, wait for the dedicated repository migration and
`schema-stream@4.0.1` before removing the monorepo package so cold installs exercise the canonical
artifact.

Verify the follow-up with:

```bash
bun install
bun run build
bun run type-check
bun test --timeout=25000
bun run test:packed
```

Also run `git grep -n "public-packages/schemaStream"` and confirm no build, release, or test path
still expects the removed workspace.
