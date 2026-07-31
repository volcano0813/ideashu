import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(sourceDir, '..', '..')

export function runtimePaths(root = repoRoot) {
  const runtimeRoot = resolve(process.env.IDEASHU_RUNTIME_DIR || join(root, '.ideashu'))
  return {
    root: runtimeRoot,
    runtime: join(runtimeRoot, 'runtime'),
    database: join(runtimeRoot, 'ideashu.sqlite'),
    artifacts: join(runtimeRoot, 'artifacts'),
    imports: join(runtimeRoot, 'imports'),
    tokenFile: join(runtimeRoot, 'runtime', 'tokens.json'),
    connectionFile: join(runtimeRoot, 'runtime', 'connection.json'),
  }
}

export function ensureRuntime(root = repoRoot) {
  const paths = runtimePaths(root)
  for (const folder of [paths.root, paths.runtime, paths.artifacts, paths.imports]) {
    mkdirSync(folder, { recursive: true })
  }
  if (!existsSync(paths.tokenFile)) {
    writeFileSync(
      paths.tokenFile,
      JSON.stringify(
        {
          operatorToken: randomBytes(32).toString('base64url'),
          mcpToken: randomBytes(32).toString('base64url'),
        },
        null,
        2,
      ),
      { encoding: 'utf8', mode: 0o600 },
    )
  }
  const port = Number(process.env.IDEASHU_PORT || 3210)
  writeFileSync(
    paths.connectionFile,
    JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, tokenFile: paths.tokenFile }, null, 2),
    'utf8',
  )
  return paths
}

export function loadRuntime(root = repoRoot) {
  const paths = ensureRuntime(root)
  const tokens = JSON.parse(readFileSync(paths.tokenFile, 'utf8'))
  const connection = JSON.parse(readFileSync(paths.connectionFile, 'utf8'))
  return { paths, tokens, connection }
}
