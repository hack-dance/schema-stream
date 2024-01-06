export async function Glitch({ children }) {
  return (
    <span className="hack-stack text-[inherit]">
      <span style={{ "--index": 0 } as React.CSSProperties}>{children}</span>
      <span style={{ "--index": 1 } as React.CSSProperties}>{children}</span>
      <span style={{ "--index": 2 } as React.CSSProperties}>{children}</span>
    </span>
  )
}
