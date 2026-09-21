import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildClientBundle } from '../scripts/build-client.mjs'

test('the committed client bundle matches its sources', () => {
  const onDisk = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.equal(onDisk, buildClientBundle(), 'client.js has drifted from src/ - run: node scripts/build-client.mjs')
})

test('the bundle carries the package id and no residual module syntax', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

  assert.match(source, new RegExp(`id: '${pkg.name}'`))
  assert.equal(/^[ \t]*(import|export)\s/m.test(source), false)
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
})
