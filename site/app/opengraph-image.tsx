import { ImageResponse } from "next/og"

export const alt = "Schema Stream - typed JSON, while it streams"
export const size = {
  height: 630,
  width: 1200
}
export const contentType = "image/png"

/** Renders a dependency-free monochrome social card that remains reliable at build time. */
export default function OpenGraphImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        background: "#ffffff",
        color: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        height: "100%",
        justifyContent: "space-between",
        padding: "72px",
        width: "100%"
      }}
    >
      <div
        style={{
          alignItems: "center",
          borderBottom: "2px solid #0a0a0a",
          display: "flex",
          fontSize: 24,
          justifyContent: "space-between",
          paddingBottom: 24
        }}
      >
        <span>schema.stream</span>
        <span>TypeScript / Bun / Node.js</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 650 }}>Schema Stream</div>
        <div style={{ display: "flex", fontSize: 36, lineHeight: 1.35 }}>
          Typed JSON, while it streams.
        </div>
      </div>

      <div
        style={{
          alignItems: "center",
          display: "flex",
          fontSize: 22,
          justifyContent: "space-between"
        }}
      >
        <span>{'{ "status": "streaming", "valid": true }'}</span>
        <span>github.com/hack-dance/schema-stream</span>
      </div>
    </div>,
    size
  )
}
