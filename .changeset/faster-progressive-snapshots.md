---
"schema-stream": minor
---

Reduce progressive parsing overhead by batching internal partial-string updates at source-chunk
boundaries when completion callbacks are unused, using safe fast property writes, and materializing
`iterate()` snapshots directly without a UTF-8 JSON round trip. External and exotic defaults retain
the previous JSON normalization behavior. Add the low-overhead `onValueComplete` event for
child-before-parent completion deltas with their completed values while preserving the legacy
progress callback. Add a polished Bun and Node benchmark, complex completion coverage, runnable
examples, server-to-browser transport guidance, and deterministic plus opt-in live SDK integration
tests, including a guarded Mastra Agent compatibility example and weekly live canary.
