import { basename, resolve } from "node:path"

export const REPOSITORY_ROOT =
  basename(process.cwd()) === "site" ? resolve(process.cwd(), "..") : process.cwd()
