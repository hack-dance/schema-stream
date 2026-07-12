import { ImageResponse } from "next/og"

export const size = { height: 64, width: 64 }
export const contentType = "image/png"

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#111111",
        color: "#ffffff",
        display: "flex",
        fontFamily: "monospace",
        fontSize: 27,
        height: "100%",
        justifyContent: "center",
        width: "100%"
      }}
    >
      {"{}"}
    </div>,
    size
  )
}
