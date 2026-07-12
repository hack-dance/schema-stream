import { relative, sep } from "node:path"
import {
  type ClassDeclaration,
  type ClassElement,
  ModifierFlags,
  type Node,
  SyntaxKind
} from "typescript/unstable/ast"
import {
  isClassDeclaration,
  isConstructorDeclaration,
  isEnumDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isMethodDeclaration,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isPrivateIdentifier,
  isStringLiteral,
  isTypeAliasDeclaration
} from "typescript/unstable/ast/is"
import {
  API,
  type Checker,
  type Symbol as CompilerSymbol,
  type Diagnostic,
  DiagnosticCategory,
  NodeBuilderFlags,
  type Project,
  SymbolFlags
} from "typescript/unstable/async"
import {
  type GeneratedDocument,
  publicApiOutputPath,
  publicEntryPath,
  repositoryRoot
} from "./config"

type ApiKind = "Class" | "Enum" | "Function" | "Interface" | "Type" | "Value"

type ApiMember = {
  description: string
  name: string
  signature: string
}

type ApiExport = {
  description: string
  kind: ApiKind
  members: ApiMember[]
  name: string
  signature: string
  sourcePath: string
}

type PublicProject = {
  api: API
  checker: Checker
  project: Project
  sourceFile: Node
}

const signatureFlags =
  NodeBuilderFlags.NoTruncation +
  NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope +
  NodeBuilderFlags.WriteTypeArgumentsOfSignature
const documentationWhitespacePattern = /\s+/g
const jsDocPattern = /\/\*\*([\s\S]*?)\*\/\s*$/
const jsDocLinePattern = /^\s*\* ?/
const trailingSemicolonPattern = /;$/
const anchorPunctuationPattern = /[^a-z0-9 -]/g
const anchorWhitespacePattern = /\s+/g

function hasFlag(value: number, flag: number): boolean {
  return Math.floor(value / flag) % 2 === 1
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const source = diagnostic.fileName
    ? `${relative(repositoryRoot, diagnostic.fileName)}:${diagnostic.pos}`
    : "project"
  return `${source} TS${diagnostic.code}: ${diagnostic.text}`
}

async function createPublicProject(): Promise<PublicProject> {
  const api = new API({ cwd: repositoryRoot })
  try {
    const snapshot = await api.updateSnapshot({ openProjects: ["tsconfig.json"] })
    const project = await snapshot.getDefaultProjectForFile(publicEntryPath)
    if (!project) {
      throw new Error(`TypeScript did not create a project for ${publicEntryPath}`)
    }
    const sourceFile = await project.program.getSourceFile(publicEntryPath)
    if (!sourceFile) {
      throw new Error(`TypeScript did not load ${publicEntryPath}`)
    }

    const diagnostics = [
      ...(await project.program.getProgramDiagnostics()),
      ...(await project.program.getConfigFileParsingDiagnostics()),
      ...(await project.program.getSyntacticDiagnostics(publicEntryPath)),
      ...(await project.program.getSemanticDiagnostics(publicEntryPath))
    ].filter(diagnostic => diagnostic.category === DiagnosticCategory.Error)
    if (diagnostics.length > 0) {
      throw new Error(diagnostics.map(formatDiagnostic).join("\n"))
    }

    return { api, checker: project.checker, project, sourceFile }
  } catch (error) {
    await api.close()
    throw error
  }
}

async function getDescription(symbol: CompilerSymbol, checker: Checker): Promise<string> {
  return (await checker.getDocumentationCommentOfSymbol(symbol))
    .replace(documentationWhitespacePattern, " ")
    .trim()
}

async function resolveExportSymbol(
  symbol: CompilerSymbol,
  checker: Checker
): Promise<CompilerSymbol> {
  return hasFlag(symbol.flags, SymbolFlags.Alias) ? await checker.getAliasedSymbol(symbol) : symbol
}

async function getDeclaration(symbol: CompilerSymbol, project: Project): Promise<Node> {
  const handle = symbol.valueDeclaration ?? symbol.declarations[0]
  const declaration = await handle?.resolve(project)
  if (!declaration) {
    throw new Error(`Export "${symbol.name}" does not have a resolvable declaration`)
  }
  return declaration
}

function getApiKind(declaration: Node): ApiKind {
  if (isClassDeclaration(declaration)) {
    return "Class"
  }
  if (isFunctionDeclaration(declaration)) {
    return "Function"
  }
  if (isInterfaceDeclaration(declaration)) {
    return "Interface"
  }
  if (isTypeAliasDeclaration(declaration)) {
    return "Type"
  }
  if (isEnumDeclaration(declaration)) {
    return "Enum"
  }
  return "Value"
}

function getMemberName(member: ClassElement): string | undefined {
  if (isConstructorDeclaration(member)) {
    return "constructor"
  }
  if (!isMethodDeclaration(member)) {
    return
  }
  if (isIdentifier(member.name) || isPrivateIdentifier(member.name)) {
    return member.name.text
  }
  if (
    isStringLiteral(member.name) ||
    isNoSubstitutionTemplateLiteral(member.name) ||
    isNumericLiteral(member.name)
  ) {
    return member.name.text
  }
  return member.name.getText()
}

function getNodeDocumentation(node: Node): string {
  const sourceFile = node.getSourceFile()
  const leadingText = sourceFile.text.slice(node.getFullStart(), node.getStart(sourceFile))
  const comment = jsDocPattern.exec(leadingText)?.[1]
  if (!comment) {
    return ""
  }
  return comment
    .split("\n")
    .map(line => line.replace(jsDocLinePattern, "").trim())
    .filter(line => line.length > 0)
    .filter(line => !line.startsWith("@"))
    .join(" ")
}

/**
 * Converts checker signatures back to declaration nodes so class documentation contains public
 * signatures without implementation bodies or private state.
 */
async function getClassMembers({
  checker,
  declaration,
  project
}: {
  checker: Checker
  declaration: ClassDeclaration
  project: Project
}): Promise<ApiMember[]> {
  const publicMembers = declaration.members.filter(
    member =>
      (isConstructorDeclaration(member) || isMethodDeclaration(member)) &&
      !hasFlag(member.modifierFlags, ModifierFlags.Private) &&
      !hasFlag(member.modifierFlags, ModifierFlags.Protected)
  )
  const members = await Promise.all(
    publicMembers.map(async member => {
      const name = getMemberName(member)
      const signature = await checker.getSignatureFromDeclaration(member)
      if (!(name && signature)) {
        return
      }

      const signatureKind = isConstructorDeclaration(member)
        ? SyntaxKind.Constructor
        : SyntaxKind.MethodSignature
      const signatureNode = await checker.signatureToSignatureDeclaration(
        signature,
        signatureKind,
        member,
        signatureFlags
      )
      if (!signatureNode) {
        throw new Error(`TypeScript could not render SchemaStream.${name}`)
      }
      const rendered = (await project.emitter.printNode(signatureNode)).replace(
        trailingSemicolonPattern,
        ""
      )
      const memberSymbol = isMethodDeclaration(member)
        ? await checker.getSymbolAtLocation(member.name)
        : undefined
      const description = memberSymbol
        ? await getDescription(memberSymbol, checker)
        : getNodeDocumentation(member)

      return {
        description,
        name,
        signature: isMethodDeclaration(member) ? `${name}${rendered}` : rendered
      }
    })
  )

  return members.filter((member): member is ApiMember => member !== undefined)
}

async function getDeclarationSignature({
  checker,
  declaration,
  project,
  symbol
}: {
  checker: Checker
  declaration: Node
  project: Project
  symbol: CompilerSymbol
}): Promise<string> {
  if (isClassDeclaration(declaration)) {
    const name = declaration.name?.text ?? "anonymous"
    const typeParameters = declaration.typeParameters
      ? `<${declaration.typeParameters.map(parameter => parameter.getText()).join(", ")}>`
      : ""
    return `class ${name}${typeParameters}`
  }

  if (isFunctionDeclaration(declaration)) {
    const signature = await checker.getSignatureFromDeclaration(declaration)
    if (signature) {
      const signatureNode = await checker.signatureToSignatureDeclaration(
        signature,
        SyntaxKind.FunctionDeclaration,
        declaration,
        signatureFlags
      )
      if (signatureNode) {
        return (await project.emitter.printNode(signatureNode)).replace(
          trailingSemicolonPattern,
          ""
        )
      }
    }
  }

  if (
    isTypeAliasDeclaration(declaration) ||
    isInterfaceDeclaration(declaration) ||
    isEnumDeclaration(declaration)
  ) {
    return declaration.getText(declaration.getSourceFile())
  }

  const type = await checker.getTypeOfSymbol(symbol)
  return type
    ? `const ${symbol.name}: ${await checker.typeToString(type, declaration, signatureFlags)}`
    : declaration.getText(declaration.getSourceFile())
}

async function getApiExports(): Promise<ApiExport[]> {
  const { api, checker, project, sourceFile } = await createPublicProject()
  try {
    const moduleSymbol = await checker.getSymbolAtLocation(sourceFile)
    if (!moduleSymbol) {
      throw new Error("Unable to resolve the src/index.ts module symbol")
    }

    const exportSymbols = await checker.getExportsOfModule(moduleSymbol)
    const apiExports = await Promise.all(
      exportSymbols.map(async exportSymbol => {
        const symbol = await resolveExportSymbol(exportSymbol, checker)
        const declaration = await getDeclaration(symbol, project)
        const sourcePath = relative(repositoryRoot, declaration.getSourceFile().fileName)
          .split(sep)
          .join("/")
        const exportDescription = await getDescription(exportSymbol, checker)
        const description = exportDescription || (await getDescription(symbol, checker))

        return {
          description,
          kind: getApiKind(declaration),
          members: isClassDeclaration(declaration)
            ? await getClassMembers({ checker, declaration, project })
            : [],
          name: exportSymbol.name,
          signature: await getDeclarationSignature({ checker, declaration, project, symbol }),
          sourcePath
        }
      })
    )

    return apiExports.sort((left, right) => {
      const kindDifference = left.kind.localeCompare(right.kind)
      return kindDifference === 0 ? left.name.localeCompare(right.name) : kindDifference
    })
  } finally {
    await api.close()
  }
}

function headingAnchor(name: string): string {
  return name
    .toLowerCase()
    .replace(anchorPunctuationPattern, "")
    .replace(anchorWhitespacePattern, "-")
}

function renderMember(member: ApiMember): string {
  const description = member.description ? `\n${member.description}\n` : ""
  return `#### ${member.name}\n${description}\n\`\`\`ts\n${member.signature}\n\`\`\``
}

function renderExport(apiExport: ApiExport): string {
  const description = apiExport.description || "No public description is currently available."
  const members =
    apiExport.members.length > 0 ? `\n\n${apiExport.members.map(renderMember).join("\n\n")}` : ""

  return `### ${apiExport.name}

${description}

**Kind:** ${apiExport.kind} | **Source:** [\`${apiExport.sourcePath}\`](../../${apiExport.sourcePath})

\`\`\`ts
${apiExport.signature}
\`\`\`${members}`
}

function renderPublicApi(exports: ApiExport[]): string {
  const exportTable = exports
    .map(
      apiExport =>
        `| [\`${apiExport.name}\`](#${headingAnchor(apiExport.name)}) | ${apiExport.kind} | ${apiExport.description || "No description"} |`
    )
    .join("\n")
  const groups = new Map<ApiKind, ApiExport[]>()
  for (const apiExport of exports) {
    const group = groups.get(apiExport.kind) ?? []
    group.push(apiExport)
    groups.set(apiExport.kind, group)
  }
  const detailSections = [...groups.entries()]
    .map(
      ([kind, entries]) =>
        `## ${kind === "Class" ? "Classes" : `${kind}s`}\n\n${entries.map(renderExport).join("\n\n")}`
    )
    .join("\n\n")

  return `<!-- Generated by scripts/docs/generate.ts. Do not edit directly. -->

# Public API reference

This reference is generated with the installed TypeScript compiler API from every export reachable through [\`src/index.ts\`](../../src/index.ts). It documents the package entry point rather than implementation-only exports.

For complete usage, see the [progressive JSON example](../../examples/progressive-json.ts), [SDK examples](../../examples/sdk-mocks.ts), [Mastra example](../../examples/mastra.ts), and [Bun WebSocket UI](../../examples/websocket-ui/).

## Exports

| Name | Kind | Description |
| --- | --- | --- |
${exportTable}

${detailSections}
`
}

/**
 * Generates the public API reference from TypeScript's resolved entry-point export graph.
 *
 * @returns Canonical output path and deterministic Markdown content.
 */
export async function generatePublicApiDocument(): Promise<GeneratedDocument> {
  const exports = await getApiExports()
  if (exports.length === 0) {
    throw new Error("src/index.ts does not expose any public symbols")
  }

  return {
    content: renderPublicApi(exports),
    path: publicApiOutputPath
  }
}
