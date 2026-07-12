"use client"

import { useTheme } from "next-themes"
import { Suspense, use, useCallback, useEffect, useId, useState } from "react"

type DiagramTheme = "dark" | "light"

type DiagramResult =
  | { status: "error" }
  | {
      status: "ready"
      svg: string
    }

const renderCache = new Map<string, Promise<DiagramResult>>()

const diagramThemes = {
  dark: {
    background: "#0d0d0d",
    clusterBkg: "#181818",
    clusterBorder: "#353535",
    edgeLabelBackground: "#0d0d0d",
    lineColor: "#a0a09c",
    primaryBorderColor: "#78aaff",
    primaryColor: "#171717",
    primaryTextColor: "#f4f4f2",
    secondaryBorderColor: "#353535",
    secondaryColor: "#242424",
    secondaryTextColor: "#f4f4f2",
    tertiaryBorderColor: "#285e3c",
    tertiaryColor: "#10291b",
    tertiaryTextColor: "#f4f4f2",
    textColor: "#f4f4f2"
  },
  light: {
    background: "#ffffff",
    clusterBkg: "#f7f7f5",
    clusterBorder: "#dddddd",
    edgeLabelBackground: "#ffffff",
    lineColor: "#646464",
    primaryBorderColor: "#0057d9",
    primaryColor: "#ffffff",
    primaryTextColor: "#111111",
    secondaryBorderColor: "#dddddd",
    secondaryColor: "#f7f7f5",
    secondaryTextColor: "#111111",
    tertiaryBorderColor: "#b8e1c7",
    tertiaryColor: "#eef9f2",
    tertiaryTextColor: "#111111",
    textColor: "#111111"
  }
} as const

function getRenderPromise({
  chart,
  id,
  theme
}: {
  chart: string
  id: string
  theme: DiagramTheme
}): Promise<DiagramResult> {
  const cacheKey = `${id}:${theme}:${chart}`
  const cached = renderCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const promise = renderDiagram({ chart, id, theme })
  renderCache.set(cacheKey, promise)
  return promise
}

async function renderDiagram({
  chart,
  id,
  theme
}: {
  chart: string
  id: string
  theme: DiagramTheme
}): Promise<DiagramResult> {
  try {
    const { default: mermaid } = await import("mermaid")
    mermaid.initialize({
      flowchart: {
        curve: "basis",
        htmlLabels: false,
        nodeSpacing: 42,
        padding: 14,
        rankSpacing: 58,
        useMaxWidth: true
      },
      fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif",
      securityLevel: "strict",
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: "base",
      themeCSS:
        ".node rect { rx: 5px; ry: 5px; stroke-width: 1.25px; } .cluster rect { rx: 7px; ry: 7px; } .edgePath .path { stroke-width: 1.4px; }",
      themeVariables: diagramThemes[theme]
    })

    const result = await mermaid.render(id, chart)
    return { status: "ready", svg: result.svg }
  } catch {
    return { status: "error" }
  }
}

function mountSvg({
  container,
  label,
  svg
}: {
  container: HTMLDivElement
  label: string
  svg: string
}): void {
  const documentResult = new DOMParser().parseFromString(svg, "image/svg+xml")
  const root = documentResult.documentElement
  if (root.tagName.toLowerCase() !== "svg" || documentResult.querySelector("parsererror")) {
    container.replaceChildren()
    return
  }

  const svgElement = document.importNode(root, true)
  svgElement.setAttribute("aria-label", label)
  svgElement.setAttribute("role", "img")
  container.replaceChildren(svgElement)
}

function MermaidContent({ chart, label }: { chart: string; label: string }) {
  const reactId = useId().replaceAll(":", "")
  const { resolvedTheme } = useTheme()
  const theme: DiagramTheme = resolvedTheme === "dark" ? "dark" : "light"
  const result = use(getRenderPromise({ chart, id: `schema-stream-diagram-${reactId}`, theme }))
  const setContainer = useCallback(
    (container: HTMLDivElement | null) => {
      if (container && result.status === "ready") {
        mountSvg({ container, label, svg: result.svg })
      }
    },
    [label, result]
  )

  if (result.status === "error") {
    return (
      <div className="mermaid-error" role="status">
        Diagram unavailable. The source remains available in the Markdown file.
      </div>
    )
  }

  return <div className="mermaid-canvas" ref={setContainer} />
}

function MermaidPlaceholder() {
  return <div aria-hidden="true" className="mermaid-placeholder" />
}

function MermaidSourceFallback({ chart }: { chart: string }) {
  return (
    <noscript>
      <pre className="mermaid-source-fallback">
        <code>{chart}</code>
      </pre>
    </noscript>
  )
}

/** Renders a Mermaid fence as an accessible, theme-aware inline SVG. */
export function Mermaid({
  chart,
  label = "Architecture flow diagram"
}: {
  chart: string
  label?: string
}) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    if (!container || shouldRender) {
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setShouldRender(true)
          observer.disconnect()
        }
      },
      { rootMargin: "320px 0px" }
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [container, shouldRender])

  return (
    <figure className="mermaid-diagram not-prose" ref={setContainer}>
      {shouldRender ? (
        <Suspense fallback={<MermaidPlaceholder />}>
          <MermaidContent chart={chart} label={label} />
        </Suspense>
      ) : (
        <MermaidPlaceholder />
      )}
      <MermaidSourceFallback chart={chart} />
    </figure>
  )
}
