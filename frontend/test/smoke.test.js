import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'src')

test('router exposes four primary product entries and legacy redirects', () => {
  const router = readFileSync(resolve(root, 'routes', 'AppRouter.tsx'), 'utf8')
  for (const route of ['/accounts', '/materials', '/create', '/works']) assert.match(router, new RegExp(route))
  for (const legacy of ['/workspace', '/material-bank', '/knowledge-base']) assert.match(router, new RegExp(legacy))
})

test('frontend runtime contains no legacy gateway or chat protocol', () => {
  const vite = readFileSync(resolve(import.meta.dirname, '..', 'vite.config.ts'), 'utf8').toLowerCase()
  const app = readFileSync(resolve(root, 'App.tsx'), 'utf8').toLowerCase()
  for (const forbidden of ['open' + 'claw', '18789', '__open' + 'claw', '/api/sync']) {
    assert.equal(vite.includes(forbidden) || app.includes(forbidden), false)
  }
})
