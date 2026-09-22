import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEEPSEEK_PEAK_PRESET,
  SCHEDULE_ZONE_CHOICES,
  convertHHMM,
  parseHHMM,
  presetWindowsFor,
  utcOffsetMinutes,
  wallClock,
  wallToInstant,
  wallToInstants,
} from '../src/core.js'

const ORDINARY_DAY = Date.UTC(2026, 8, 21, 12, 0)
const DST_DAYS = {
  'US spring forward': Date.UTC(2026, 2, 8, 7, 30),
  'US fall back': Date.UTC(2026, 10, 1, 5, 30),
  'EU spring forward': Date.UTC(2026, 2, 29, 1, 30),
  'NZ spring forward': Date.UTC(2026, 8, 27, 14, 0),
}

const SAMPLE_ZONES = [
  'Asia/Dubai',
  'America/Halifax',
  'Asia/Shanghai',
  'Europe/London',
  'America/New_York',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Pacific/Chatham',
  'Australia/Eucla',
  'Pacific/Kiritimati',
  'Pacific/Pago_Pago',
  'Australia/Lord_Howe',
]

const TIMES = ['00:00', '00:30', '04:58', '08:02', '09:00', '12:00', '13:58', '18:02', '23:30', '23:59']

test('a conversion holds the instant fixed, for every zone', () => {
  for (const zone of SCHEDULE_ZONE_CHOICES) {
    for (const time of TIMES) {
      const there = convertHHMM('Asia/Shanghai', zone, time, ORDINARY_DAY)
      const back = convertHHMM(zone, 'Asia/Shanghai', there, ORDINARY_DAY)
      assert.equal(back, time, `Shanghai ${time} -> ${zone} -> ${back}`)
    }
  }
})

test('every zone pair round-trips exactly on an ordinary day', () => {
  let checked = 0
  for (const from of SAMPLE_ZONES) {
    for (const to of SAMPLE_ZONES) {
      if (from === to) continue
      for (const time of TIMES) {
        const there = convertHHMM(from, to, time, ORDINARY_DAY)
        assert.equal(convertHHMM(to, from, there, ORDINARY_DAY), time, `${from} -> ${to} -> back (${time})`)
        checked += 1
      }
    }
  }
  assert.ok(checked > 1000, `expected a broad sweep, checked ${checked}`)
})

test('a three-zone chain round-trips exactly on an ordinary day', () => {
  let checked = 0
  for (const a of SAMPLE_ZONES) {
    for (const b of SAMPLE_ZONES) {
      for (const c of SAMPLE_ZONES) {
        if (a === b || b === c || a === c) continue
        for (const time of TIMES) {
          const step1 = convertHHMM(a, b, time, ORDINARY_DAY)
          const step2 = convertHHMM(b, c, step1, ORDINARY_DAY)
          assert.equal(convertHHMM(c, a, step2, ORDINARY_DAY), time, `${a} -> ${b} -> ${c} -> ${a} (${time})`)
          checked += 1
        }
      }
    }
  }
  assert.ok(checked > 10000, `expected a broad sweep, checked ${checked}`)
})

test('zones whose offset is not a multiple of 30 minutes resolve', () => {
  // +05:45, +12:45 and +08:45 are unreachable by a 30-minute stride.
  const quarterHourZones = ['Asia/Kathmandu', 'Pacific/Chatham', 'Australia/Eucla']
  for (const zone of quarterHourZones) {
    assert.notEqual(utcOffsetMinutes(zone, ORDINARY_DAY) % 30, 0, `${zone} should carry a quarter-hour offset`)

    const resolved = wallToInstants(zone, 2026, 9, 21, parseHHMM('01:45'))
    assert.ok(resolved.length >= 1, `${zone} 01:45 must resolve to an instant`)
    assert.equal(wallClock(zone, new Date(resolved[0])).minutes, parseHHMM('01:45'))

    const there = convertHHMM(zone, 'Asia/Shanghai', '01:45', ORDINARY_DAY)
    assert.notEqual(there, '01:45', `${zone} -> Shanghai must actually convert, not no-op`)
    assert.equal(convertHHMM('Asia/Shanghai', zone, there, ORDINARY_DAY), '01:45', `${zone} round trip`)
  }
})

test('the DeepSeek preset converts exactly into any offered zone and back', () => {
  for (const zone of SCHEDULE_ZONE_CHOICES) {
    const windows = presetWindowsFor(zone, ORDINARY_DAY)
    windows.forEach((window, index) => {
      const source = DEEPSEEK_PEAK_PRESET.windows[index]
      assert.equal(
        convertHHMM(zone, DEEPSEEK_PEAK_PRESET.zone, window.pauseAt, ORDINARY_DAY),
        source.pauseAt,
        `${zone} ${window.pauseAt} should convert back to Beijing ${source.pauseAt}`,
      )
      assert.equal(
        convertHHMM(zone, DEEPSEEK_PEAK_PRESET.zone, window.resumeAt, ORDINARY_DAY),
        source.resumeAt,
        `${zone} ${window.resumeAt} should convert back to Beijing ${source.resumeAt}`,
      )
    })
  }
})

test('a DST gap resolves past the gap rather than failing', () => {
  // 02:30 does not exist in New York on this date.
  assert.deepEqual(wallToInstants('America/New_York', 2026, 3, 8, parseHHMM('02:30')), [])
  assert.equal(new Date(wallToInstant('America/New_York', 2026, 3, 8, parseHHMM('02:30'))).toISOString(), '2026-03-08T07:00:00.000Z')
})

test('a repeated wall time yields both instants, earliest chosen', () => {
  const both = wallToInstants('America/New_York', 2026, 11, 1, parseHHMM('01:30'))
  assert.equal(both.length, 2)
  assert.equal(wallToInstant('America/New_York', 2026, 11, 1, parseHHMM('01:30')), Math.min(...both))
})

test('a round trip can differ by the daylight-saving delta on a transition day', () => {
  // Known limitation: a conversion carries no date and re-anchors to today.
  for (const [dayName, reference] of Object.entries(DST_DAYS)) {
    for (const from of SAMPLE_ZONES) {
      for (const to of SAMPLE_ZONES) {
        if (from === to) continue
        for (const time of TIMES) {
          const there = convertHHMM(from, to, time, reference)
          const back = convertHHMM(to, from, there, reference)
          if (back === time) continue
          const delta = Math.abs(parseHHMM(back) - parseHHMM(time))
          const wrapped = Math.min(delta, 1440 - delta)
          assert.ok(
            wrapped <= 60,
            `${dayName}: ${from} -> ${to} -> ${from} drifted ${wrapped} min (${time} -> ${there} -> ${back})`,
          )
        }
      }
    }
  }
})
