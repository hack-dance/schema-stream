import { ImageResponse } from "next/og"

export const alt = "Schema Stream - typed JSON, while it streams"
export const size = {
  height: 630,
  width: 1200
}
export const contentType = "image/png"

/** Renders the Twitter card independently so Next can statically emit both image conventions. */
export default function TwitterImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        background: "#0a0a0a",
        color: "#ffffff",
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
          borderBottom: "2px solid #ffffff",
          display: "flex",
          fontSize: 24,
          justifyContent: "space-between",
          paddingBottom: 24
        }}
      >
        <span>schema.stream</span>
        <span>Typed streaming JSON</span>
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
        <span>{'{ "snapshot": "complete" }'}</span>
        <span>npm i schema-stream</span>
      </div>
    </div>,
    size
  )
}
