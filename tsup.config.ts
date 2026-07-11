import { defineConfig } from "tsup"

export default defineConfig(options => ({
  clean: !options.watch,
  entry: ["src/index.ts"],
  dts: false,
  watch: options.watch,
  sourcemap: true,
  minify: true,
  target: "es2020",
  format: ["cjs", "esm"],
  external: ["zod"]
}))
