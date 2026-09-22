import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHistory } from '../src/history.js'

const workspace = () => mkdtempSync(join(tmpdir(), 'offpeak-history-'))

test('a fresh history starts empty and is not invented', () => {
  const dir = workspace()
  const history = createHistory({ filePath: join(dir, 'offpeak-history.json') })
  assert.deepEqual(history.load(), [])
  assert.equal(history.size, 0)
})

test('recorded samples survive a reload', () => {
  const dir = workspace()
  const file = join(dir, 'offpeak-history.json')
  const history = createHistory({ filePath: file })

  history.record(41.82, 1000)
  history.record(41.5, 2000)

  const reloaded = createHistory({ filePath: file })
  assert.deepEqual(reloaded.load(), [
    { at: 1000, total: 41.82 },
    { at: 2000, total: 41.5 },
  ])
})

test('a non-finite balance is never recorded', () => {
  const dir = workspace()
  const history = createHistory({ filePath: join(dir, 'offpeak-history.json') })

  history.record(Number.NaN, 1000)
  history.record(undefined, 2000)
  history.record(null, 3000)

  assert.equal(history.size, 0)
})

test('recording twice at the same instant replaces rather than duplicates', () => {
  const dir = workspace()
  const history = createHistory({ filePath: join(dir, 'offpeak-history.json') })

  history.record(41.82, 1000)
  history.record(41.5, 1000)

  assert.deepEqual(history.all(), [{ at: 1000, total: 41.5 }])
})

test('the ring caps at 288 samples, dropping the oldest', () => {
  const dir = workspace()
  const history = createHistory({ filePath: join(dir, 'offpeak-history.json') })

  for (let index = 0; index < 300; index += 1) history.record(100 - index, index)

  assert.equal(history.size, 288)
  assert.equal(history.all()[0].at, 12)
  assert.equal(history.all()[287].at, 299)
})

test('junk entries in the file are discarded rather than trusted', () => {
  const dir = workspace()
  const file = join(dir, 'offpeak-history.json')
  writeFileSync(
    file,
    JSON.stringify({ version: 2,
      samples: [
        { at: 1000, total: 41.82 },
        { at: 'nope', total: 1 },
        { at: 2000, total: null },
        { at: 3000 },
        'garbage',
      ],
    }),
  )

  const history = createHistory({ filePath: file })
  assert.deepEqual(history.load(), [{ at: 1000, total: 41.82 }])
})

test('samples are sorted by instant regardless of file order', () => {
  const dir = workspace()
  const file = join(dir, 'offpeak-history.json')
  writeFileSync(
    file,
    JSON.stringify({ version: 2,
      samples: [
        { at: 3000, total: 3 },
        { at: 1000, total: 1 },
        { at: 2000, total: 2 },
      ],
    }),
  )

  assert.deepEqual(
    createHistory({ filePath: file }).load().map((sample) => sample.at),
    [1000, 2000, 3000],
  )
})

test('a file from an older format is discarded, not trusted', () => {
  const dir = workspace()
  const file = join(dir, 'offpeak-history.json')
  const reports = []
  // Version 1 could hold samples merged in from a predecessor plugin.
  writeFileSync(file, JSON.stringify({ version: 1, samples: [{ at: 1000, total: 41.82 }] }))

  const history = createHistory({ filePath: file, report: (tag, value) => reports.push([tag, value]) })
  assert.deepEqual(history.load(), [], 'an old-format file is not adopted')
  assert.ok(reports.some(([tag, value]) => tag === 'history discarded' && value.found === 1))
})

test('a file with no version is discarded too', () => {
  const dir = workspace()
  const file = join(dir, 'offpeak-history.json')
  writeFileSync(file, JSON.stringify({ samples: [{ at: 1000, total: 41.82 }] }))

  assert.deepEqual(createHistory({ filePath: file }).load(), [])
})

test('the currency is stored beside the samples and survives a reload', () => {
  const dir = workspace()
  const file = join(dir, 'offpeak-history.json')
  const history = createHistory({ filePath: file })
  assert.equal(history.currency, null, 'unknown until a sample supplies it')

  history.record(39.78, 1000, 'CNY')
  assert.equal(history.currency, 'CNY')

  const reloaded = createHistory({ filePath: file })
  reloaded.load()
  assert.equal(reloaded.currency, 'CNY', 'the chart can label amounts without the balance endpoint')
  assert.equal(reloaded.size, 1)
})

test('a sample without a currency does not erase the one already known', () => {
  const dir = workspace()
  const history = createHistory({ filePath: join(dir, 'offpeak-history.json') })

  history.record(39.78, 1000, 'CNY')
  history.record(39.5, 2000)
  assert.equal(history.currency, 'CNY')
})

test('an unreadable file reports instead of throwing', () => {
  const dir = workspace()
  const reports = []
  const file = join(dir, 'offpeak-history.json')
  writeFileSync(file, 'not json at all')

  const history = createHistory({ filePath: file, report: (tag, value) => reports.push([tag, value]) })
  assert.deepEqual(history.load(), [])
  assert.ok(reports.some(([tag]) => tag === 'history load failed'))
})

test('this plugin reads only its own file', () => {
  const dir = workspace()
  const file = join(dir, 'offpeak-history.json')
  // A predecessor's file in the same directory must be ignored.
  writeFileSync(join(dir, 'dsh-save-money-balance.json'), JSON.stringify({ points: [{ at: 1000, total: 41.82 }] }))

  const history = createHistory({ filePath: file })
  assert.deepEqual(history.load(), [], 'a predecessor file is not adopted')
  assert.equal(existsSync(file), false, 'and nothing is written from it')
})
