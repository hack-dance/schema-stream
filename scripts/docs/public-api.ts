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
  type JSDocTagInfo,
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

type ApiNamedDocumentation = {
  description: string
  name: string
}

type ApiThrowDocumentation = {
  description: string
  type: string
}

type ApiDocumentation = {
  description: string
  parameters: ApiNamedDocumentation[]
  returns: string[]
  throws: ApiThrowDocumentation[]
  typeParameters: ApiNamedDocumentation[]
}

type ApiMember = {
  documentation: ApiDocumentation
  name: string
  signature: string
}

type ApiExport = {
  documentation: ApiDocumentation
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
const jsDocTagPattern = /^@(\S+)(?:\s+(.*))?$/
const namedDocumentationPattern = /^(\S+)(?:\s+-\s+|\s+)?([\s\S]*)$/
const throwDocumentationPattern = /^\{([^}]+)\}(?:\s+-\s+|\s+)?([\s\S]*)$/
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

function normalizeDocumentationText(value: string): string {
  return value.replace(documentationWhitespacePattern, " ").trim()
}

function parseNamedDocumentation(text: string): ApiNamedDocumentation {
  const normalized = normalizeDocumentationText(text)
  const match = namedDocumentationPattern.exec(normalized)
  return {
    description: match?.[2]?.trim() ?? "",
    name: match?.[1] ?? normalized
  }
}

function parseThrowDocumentation(text: string): ApiThrowDocumentation {
  const normalized = normalizeDocumentationText(text)
  const match = throwDocumentationPattern.exec(normalized)
  return {
    description: match?.[2]?.trim() ?? normalized,
    type: match?.[1] ?? "Error"
  }
}

function createDocumentation({
  description,
  tags
}: {
  description: string
  tags: readonly JSDocTagInfo[]
}): ApiDocumentation {
  const documentation: ApiDocumentation = {
    description: normalizeDocumentationText(description),
    parameters: [],
    returns: [],
    throws: [],
    typeParameters: []
  }

  for (const tag of tags) {
    const text = tag.text?.trim() ?? ""
    const tagName = tag.name.toLowerCase()
    if (tagName === "param") {
      documentation.parameters.push(parseNamedDocumentation(text))
    } else if (tagName === "return" || tagName === "returns") {
      documentation.returns.push(normalizeDocumentationText(text))
    } else if (tagName === "throws" || tagName === "exception") {
      documentation.throws.push(parseThrowDocumentation(text))
    } else if (tagName === "typeparam" || tagName === "template") {
      documentation.typeParameters.push(parseNamedDocumentation(text))
    }
  }

  return documentation
}

async function getSymbolDocumentation(
  symbol: CompilerSymbol,
  checker: Checker
): Promise<ApiDocumentation> {
  const [description, tags] = await Promise.all([
    checker.getDocumentationCommentOfSymbol(symbol),
    checker.getJsDocTagsOfSymbol(symbol)
  ])
  return createDocumentation({ description, tags })
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

function getNodeDocumentation(node: Node): ApiDocumentation {
  const sourceFile = node.getSourceFile()
  const leadingText = sourceFile.text.slice(node.getFullStart(), node.getStart(sourceFile))
  const comment = jsDocPattern.exec(leadingText)?.[1]
  if (!comment) {
    return createDocumentation({ description: "", tags: [] })
  }

  const descriptionLines: string[] = []
  const tags: JSDocTagInfo[] = []
  for (const rawLine of comment.split("\n")) {
    const line = rawLine.replace(jsDocLinePattern, "").trim()
    if (line.length === 0) {
      continue
    }

    const tagMatch = jsDocTagPattern.exec(line)
    if (tagMatch) {
      tags.push({ name: tagMatch[1], text: tagMatch[2] })
      continue
    }

    const previousTag = tags.at(-1)
    if (previousTag) {
      tags[tags.length - 1] = {
        name: previousTag.name,
        text: [previousTag.text, line].filter(Boolean).join(" ")
      }
    } else {
      descriptionLines.push(line)
    }
  }

  return createDocumentation({ description: descriptionLines.join(" "), tags })
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
      const documentation = memberSymbol
        ? await getSymbolDocumentation(memberSymbol, checker)
        : getNodeDocumentation(member)

      return {
        documentation,
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
        const [exportDocumentation, symbolDocumentation] = await Promise.all([
          getSymbolDocumentation(exportSymbol, checker),
          getSymbolDocumentation(symbol, checker)
        ])
        const documentation = {
          ...symbolDocumentation,
          description: exportDocumentation.description || symbolDocumentation.description
        }

        return {
          documentation,
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

function renderNamedDocumentation(entries: ApiNamedDocumentation[]): string {
  return entries
    .map(entry => `- \`${entry.name}\`${entry.description ? ` - ${entry.description}` : ""}`)
    .join("\n")
}

function renderDocumentationDetails(documentation: ApiDocumentation): string {
  const sections: string[] = []
  if (documentation.typeParameters.length > 0) {
    sections.push(
      `**Type parameters**\n\n${renderNamedDocumentation(documentation.typeParameters)}`
    )
  }
  if (documentation.parameters.length > 0) {
    sections.push(`**Parameters**\n\n${renderNamedDocumentation(documentation.parameters)}`)
  }
  if (documentation.returns.length > 0) {
    sections.push(`**Returns**\n\n${documentation.returns.join("\n\n")}`)
  }
  if (documentation.throws.length > 0) {
    const throws = documentation.throws
      .map(entry => `- \`${entry.type}\`${entry.description ? ` - ${entry.description}` : ""}`)
      .join("\n")
    sections.push(`**Throws**\n\n${throws}`)
  }
  return sections.length > 0 ? `\n\n${sections.join("\n\n")}` : ""
}

function renderMember(member: ApiMember): string {
  const description = member.documentation.description
    ? `\n${member.documentation.description}\n`
    : ""
  const details = renderDocumentationDetails(member.documentation)
  return `#### ${member.name}\n${description}\n\`\`\`ts\n${member.signature}\n\`\`\`${details}`
}

function renderExport(apiExport: ApiExport): string {
  const description =
    apiExport.documentation.description || "No public description is currently available."
  const documentationDetails = renderDocumentationDetails(apiExport.documentation)
  const members =
    apiExport.members.length > 0 ? `\n\n${apiExport.members.map(renderMember).join("\n\n")}` : ""

  return `### ${apiExport.name}

${description}

**Kind:** ${apiExport.kind} | **Source:** [\`${apiExport.sourcePath}\`](../../${apiExport.sourcePath})

\`\`\`ts
${apiExport.signature}
\`\`\`${documentationDetails}${members}`
}

function renderPublicApi(exports: ApiExport[]): string {
  const exportTable = exports
    .map(
      apiExport =>
        `| [\`${apiExport.name}\`](#${headingAnchor(apiExport.name)}) | ${apiExport.kind} | ${apiExport.documentation.description || "No description"} |`
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
