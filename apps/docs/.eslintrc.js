/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@repo/eslint-config/next.js"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: true
  },
  settings: {
    tailwindcss: {
      callees: ["cn"],
      config: "tailwind.config.js"
    }
  }
}
