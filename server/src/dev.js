import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const service = spawn(process.execPath, ['server/src/index.js'], { cwd: root, stdio: 'inherit' })
const web = spawn(npmCommand, ['run', 'dev', '--workspace', 'frontend'], { cwd: root, stdio: 'inherit' })

function shutdown() {
  service.kill('SIGTERM')
  web.kill('SIGTERM')
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
service.on('exit', (code) => { if (code) process.exitCode = code; web.kill('SIGTERM') })
web.on('exit', (code) => { if (code) process.exitCode = code; service.kill('SIGTERM') })
