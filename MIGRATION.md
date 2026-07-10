# Repository migration

`schema-stream` moved back to this dedicated repository after version 4.0.0 shipped from the
`hack-dance/island-ai` monorepo.

## History strategy

The migration preserves both useful lineages:

- The destination branch starts from `hack-dance/schema-stream` `main`, retaining the original v1
  and v2 commits and tags.
- The source package history was filtered from `public-packages/schemaStream` at the annotated
  `schema-stream@4.0.0` tag. That tag resolves to island-ai commit
  `a736930aea286066c1f1514d033f54c891bbde6a`.
- The filtered package tip (`cf6890487bb60783ea6a677367c8c7335f42eee9`) is merged with
  `--allow-unrelated-histories`. The extraction PR therefore has both lineages as real ancestors,
  while unrelated monorepo packages are absent.

The package's historical `CHANGELOG.md` intentionally retains links to the repositories where each
older release was developed.

## Release sequence

1. `schema-stream@4.0.0` was published from island-ai and verified on npm.
2. This extraction imports that exact published package source and updates its repository metadata,
   README, tests, and release automation.
3. `.changeset/dedicated-repository.md` schedules the first release from this repository as a patch.
   The Changesets release PR will update `4.0.0` to `4.0.1` after this migration is merged.
4. Only merging the generated `changeset-release/main` PR can reach the protected Publish
   environment. This extraction PR does not publish, tag, or create a release.

## Source monorepo follow-up

The exact island-ai cleanup is documented in [docs/island-ai-follow-up.md](docs/island-ai-follow-up.md).
It is deliberately not part of this repository's branch.
