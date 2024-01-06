import { ImageResponse } from "next/og"

export const runtime = "edge"

export async function GET(req, { params }): Promise<Response> {
  const title = params.title
  const date = params.date
  const description = params.description

  if (!title) {
    return new Response("Missing title", { status: 400 })
  }

  const Blunt = fetch(new URL("./sp-blunt-regular.ttf", import.meta.url)).then(res =>
    res.arrayBuffer()
  )

  const Mono = fetch(new URL("./FantasqueSansMono-Regular.ttf", import.meta.url)).then(res =>
    res.arrayBuffer()
  )

  return new ImageResponse(
    (
      <div
        style={{
          fontFamily: "Blunt",
          display: "flex",
          height: "100%",
          width: "100%",
          alignItems: "center",
          letterSpacing: "-.02em",
          fontWeight: 700,
          background: "#000",
          flexDirection: "column"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            width: "100%",
            padding: "10px 50px"
          }}
        >
          <span
            style={{
              fontSize: 25,
              fontWeight: 700,
              background: "white",
              color: "black",
              padding: "4px 10px"
            }}
          >
            Hack.dance
          </span>
          {date && (
            <div
              style={{
                fontSize: 25,
                background: "white",
                color: "black",
                padding: "4px 10px"
              }}
            >
              {date}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            padding: "0 50px",
            color: "white",
            textAlign: "center",
            height: 630 - 50 - 50,
            maxWidth: 1000
          }}
        >
          {title && (
            <div
              style={{
                fontSize: 54,
                fontWeight: 900,
                marginBottom: 12,
                lineHeight: 1.1
              }}
            >
              {title}
            </div>
          )}
          {description && (
            <div
              style={{
                fontFamily: "Mono",
                fontSize: 26,
                fontWeight: 400,
                marginBottom: 0,
                lineHeight: 1.1
              }}
            >
              {description}
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Blunt",
          data: await Blunt,
          style: "normal",
          weight: 400
        },
        {
          name: "Mono",
          data: await Mono,
          style: "normal",
          weight: 400
        }
      ]
    }
  )
}
