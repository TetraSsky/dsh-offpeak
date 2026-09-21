import test from 'node:test'
import assert from 'node:assert/strict'
import { BUCKET_MS, WINDOW_BUCKETS, bucketLabel, spendBars, spendInWindow, windowRangeLabel } from '../src/spend.js'

const MINUTE = 60 * 1000
const NOW = Date.UTC(2026, 8, 21, 12, 0)

// A drop is spend; a rise is a top-up and must not cancel spend out.
const SAMPLES = [
  { at: NOW - 90 * MINUTE, total: 100 },
  { at: NOW - 60 * MINUTE, total: 95 },
  { at: NOW - 50 * MINUTE, total: 90 },
  { at: NOW - 40 * MINUTE, total: 200 },
  { at: NOW - 30 * MINUTE, total: 190 },
  { at: NOW - 20 * MINUTE, total: 185 },
]

test('spendInWindow sums balance drops inside the window', () => {
  assert.equal(spendInWindow(SAMPLES, NOW, 60 * MINUTE), 25)
  assert.equal(spendInWindow(SAMPLES, NOW, 30 * MINUTE), 15)
  assert.equal(spendInWindow(SAMPLES, NOW, 10 * MINUTE), 0)
})

test('a top-up never reduces measured spend', () => {
  const toppedUp = [
    { at: NOW - 20 * MINUTE, total: 10 },
    { at: NOW - 10 * MINUTE, total: 5 },
    { at: NOW - 5 * MINUTE, total: 500 },
  ]
  assert.equal(spendInWindow(toppedUp, NOW, 60 * MINUTE), 5)
})

test('spendInWindow is zero without samples, not NaN', () => {
  assert.equal(spendInWindow([], NOW, 60 * MINUTE), 0)
  assert.equal(spendInWindow([{ at: NOW, total: 5 }], NOW, 60 * MINUTE), 0)
})

test('spendBars places each drop in its own bucket and leaves gaps null', () => {
  const bars = spendBars(SAMPLES, NOW, 6, 10 * MINUTE)
  assert.deepEqual(bars, [5, null, 10, 5, null, null])
})

test('spendBars covers a full 8 hours of 10-minute buckets by default', () => {
  const bars = spendBars(SAMPLES, NOW)
  assert.equal(bars.length, WINDOW_BUCKETS)
  assert.equal(WINDOW_BUCKETS, 48)
  assert.equal(BUCKET_MS, 10 * MINUTE)
  assert.equal(
    bars.reduce((sum, value) => sum + (value ?? 0), 0),
    25,
    'every drop inside the 8-hour window is counted, including the oldest',
  )
})

test('a drop outside the window is ignored rather than clamped into the first bucket', () => {
  const ancient = [
    { at: NOW - 20 * 60 * MINUTE, total: 100 },
    { at: NOW - 20 * 60 * MINUTE + MINUTE, total: 1 },
  ]
  assert.equal(spendBars(ancient, NOW).every((value) => value === null), true)
})

test('bucketLabel renders a clock label', () => {
  assert.match(bucketLabel(0, NOW, 6, 10 * MINUTE), /^\d{2}:\d{2}$/)
  assert.match(bucketLabel(5, NOW, 6, 10 * MINUTE), /^\d{2}:\d{2}$/)
})

test('windowRangeLabel describes the span a spend window covers', () => {
  const label = windowRangeLabel(NOW, 60 * MINUTE)
  assert.match(label, /^\d{2}:\d{2}-\d{2}:\d{2}$/)

  const [from, to] = label.split('-')
  assert.notEqual(from, to)
  assert.equal(to, bucketLabel(5, NOW, 6, 10 * MINUTE), 'the right edge is the current clock')
})
