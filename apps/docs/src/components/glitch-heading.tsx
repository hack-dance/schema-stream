import { Glitch } from "./glitch"

export function GlitchHeading({ glitchText = "", plainText = null }) {
  return (
    <h1 className="w-full sm:w-auto flex gap-2 sm:gap-6 font-blunt text-4xl sm:text-6xl">
      <Glitch>{glitchText}</Glitch>
      {plainText && <span className="text-[inherit]">Dance</span>}
    </h1>
  )
}
