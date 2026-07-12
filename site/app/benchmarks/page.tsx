import { permanentRedirect } from "next/navigation"

export default function LegacyBenchmarksPage(): never {
  permanentRedirect("/approach")
}
