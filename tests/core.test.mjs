import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEEPSEEK_PEAK_PRESET,
  SCHEDULE_ZONE_CHOICES,
  computeState,
  convertHHMM,
  dayKey,
  formatHHMM,
  formatOffset,
  isValidZone,
  isoWeekday,
  nextPause,
  observesDST,
  occurrenceId,
  parseHHMM,
  presetWindowsFor,
  utcOffsetMinutes,
  wallClock,
  wallToInstant,
  wallToInstants,
  windowMatchesAt,
} from '../src/core.js'

const SHANGHAI = 'Asia/Shanghai'
const NEW_YORK = 'America/New_York'

const at = (zone, y, mo, d, hhmm) => wallToInstant(zone, y, mo, d, parseHHMM(hhmm))

const mondayOfSeptember2026 = (() => {
  for (let day = 1; day <= 7; day += 1) {
    if (new Date(Date.UTC(2026, 8, day)).getUTCDay() === 1) return { y: 2026, mo: 9, d: day }
  }
  throw new Error('no Monday found')
})()

const config = (overrides = {}) => ({
  enabled: true,
  scheduleZone: SHANGHAI,
  windows: [{ id: 'peak-am', pauseAt: '09:00', resumeAt: '12:00' }],
  activeDays: [1, 2, 3, 4, 5],
  warnMinutes: 5,
  ...overrides,
})

test('parseHHMM accepts padded and unpadded hours and rejects the rest', () => {
  assert.equal(parseHHMM('09:00'), 540)
  assert.equal(parseHHMM('9:00'), 540)
  assert.equal(parseHHMM('00:00'), 0)
  assert.equal(parseHHMM('23:59'), 1439)
  assert.equal(parseHHMM('24:00'), null)
  assert.equal(parseHHMM('9:5'), null)
  assert.equal(parseHHMM('noon'), null)
  assert.equal(parseHHMM(''), null)
  assert.equal(parseHHMM(null), null)
})

test('formatHHMM pads and wraps', () => {
  assert.equal(formatHHMM(540), '09:00')
  assert.equal(formatHHMM(0), '00:00')
  assert.equal(formatHHMM(1440), '00:00')
  assert.equal(formatHHMM(-60), '23:00')
})

test('isValidZone distinguishes real zones from typos', () => {
  assert.equal(isValidZone(SHANGHAI), true)
  assert.equal(isValidZone('UTC'), true)
  assert.equal(isValidZone('Asia/Nowhere'), false)
  assert.equal(isValidZone(''), false)
  assert.equal(isValidZone(undefined), false)
})

test('wallClock reads the wall time in the requested zone, not the host zone', () => {
  const instant = Date.UTC(2026, 8, 21, 0, 30)
  const shanghai = wallClock(SHANGHAI, new Date(instant))
  assert.deepEqual(
    { y: shanghai.y, mo: shanghai.mo, d: shanghai.d, minutes: shanghai.minutes },
    { y: 2026, mo: 9, d: 21, minutes: 510 },
  )
  assert.equal(isoWeekday(shanghai.weekday), 1)
})

test('windowMatchesAt is half-open so adjacent windows never both match', () => {
  const window = { pauseAt: '09:00', resumeAt: '12:00' }
  const wall = (minutes) => ({ y: 2026, mo: 9, d: 21, weekday: 1, minutes })
  assert.equal(windowMatchesAt(window, wall(539), [1]), false)
  assert.equal(windowMatchesAt(window, wall(540), [1]), true)
  assert.equal(windowMatchesAt(window, wall(719), [1]), true)
  assert.equal(windowMatchesAt(window, wall(720), [1]), false)
})

test('a midnight-crossing window belongs to the day it started', () => {
  const window = { pauseAt: '23:00', resumeAt: '02:00', days: [1] }
  const wall = (weekday, minutes) => ({ y: 2026, mo: 9, d: 21, weekday, minutes })

  assert.equal(windowMatchesAt(window, wall(1, 1380), []), true, 'Monday 23:00 starts it')
  assert.equal(windowMatchesAt(window, wall(2, 60), []), true, 'Tuesday 01:00 is still Mondays window')
  assert.equal(windowMatchesAt(window, wall(2, 1380), []), false, 'Tuesday 23:00 is not in days')
  assert.equal(windowMatchesAt(window, wall(1, 60), []), false, 'Monday 01:00 belongs to Sunday')
  assert.equal(windowMatchesAt(window, wall(2, 120), []), false, 'resumeAt is exclusive')
})

test('a midnight-crossing window resumes on the correct day from both halves', () => {
  const overnight = config({ windows: [{ id: 'night', pauseAt: '23:00', resumeAt: '02:00' }] })
  const expectedResume = Date.UTC(2026, 8, 21, 18, 0)

  const evening = computeState(at(SHANGHAI, 2026, 9, 21, '23:30'), overnight)
  assert.equal(evening.state, 'PAUSED')
  assert.equal(evening.resumeAt, expectedResume, 'the evening half resumes tomorrow')
  assert.equal(evening.minutesUntilResume, 150)

  const earlyMorning = computeState(at(SHANGHAI, 2026, 9, 22, '01:00'), overnight)
  assert.equal(earlyMorning.state, 'PAUSED')
  assert.equal(earlyMorning.resumeAt, expectedResume, 'the early-morning half resumes today')
  assert.equal(earlyMorning.minutesUntilResume, 60)
})

test('formatOffset labels zones the way users read them', () => {
  assert.equal(formatOffset(480), '+08:00')
  assert.equal(formatOffset(240), '+04:00')
  assert.equal(formatOffset(0), '+00:00')
  assert.equal(formatOffset(-300), '-05:00')
  assert.equal(formatOffset(345), '+05:45')
  assert.equal(formatOffset(-210), '-03:30')
})

test('formatOffset agrees with the real zones a user would pick', () => {
  const at = Date.UTC(2026, 8, 21, 12, 0)
  assert.equal(formatOffset(utcOffsetMinutes('Asia/Shanghai', at)), '+08:00')
  assert.equal(formatOffset(utcOffsetMinutes('Asia/Dubai', at)), '+04:00')
  assert.equal(formatOffset(utcOffsetMinutes('UTC', at)), '+00:00')
  assert.equal(formatOffset(utcOffsetMinutes('America/New_York', at)), '-04:00')
  assert.equal(formatOffset(utcOffsetMinutes('Asia/Kathmandu', at)), '+05:45')
})

test('utcOffsetMinutes reads the offset in force at that instant', () => {
  assert.equal(utcOffsetMinutes('Asia/Shanghai', Date.UTC(2026, 8, 21)), 480)
  assert.equal(utcOffsetMinutes('Asia/Dubai', Date.UTC(2026, 8, 21)), 240)
  assert.equal(utcOffsetMinutes('Europe/London', Date.UTC(2026, 0, 15)), 0)
  assert.equal(utcOffsetMinutes('Europe/London', Date.UTC(2026, 6, 15)), 60)
})

test('observesDST separates fixed-offset zones from shifting ones', () => {
  assert.equal(observesDST('Asia/Shanghai'), false)
  assert.equal(observesDST('Asia/Dubai'), false)
  assert.equal(observesDST('Europe/London'), true)
  assert.equal(observesDST('America/New_York'), true)
})

test('convertHHMM holds the instant fixed while the wall clock moves', () => {
  const reference = Date.UTC(2026, 8, 21, 12, 0)
  assert.equal(convertHHMM('Asia/Shanghai', 'Asia/Dubai', '08:58', reference), '04:58')
  assert.equal(convertHHMM('Asia/Shanghai', 'Asia/Dubai', '18:02', reference), '14:02')
  assert.equal(convertHHMM('Asia/Dubai', 'Asia/Shanghai', '04:58', reference), '08:58')
  assert.equal(convertHHMM('Asia/Shanghai', 'Asia/Shanghai', '09:00', reference), '09:00')
})

test('convertHHMM leaves unparseable input and unknown zones alone', () => {
  assert.equal(convertHHMM('Asia/Shanghai', 'Asia/Dubai', 'nonsense'), 'nonsense')
  assert.equal(convertHHMM('Asia/Nowhere', 'Asia/Dubai', '09:00'), '09:00')
})

test('the DeepSeek preset is expressed in the zone the user chose', () => {
  const reference = Date.UTC(2026, 8, 21, 12, 0)

  const beijing = presetWindowsFor('Asia/Shanghai', reference)
  assert.deepEqual(
    beijing.map((window) => [window.pauseAt, window.resumeAt]),
    [
      ['08:58', '12:02'],
      ['13:58', '18:02'],
    ],
  )

  const dubai = presetWindowsFor('Asia/Dubai', reference)
  assert.deepEqual(
    dubai.map((window) => [window.pauseAt, window.resumeAt]),
    [
      ['04:58', '08:02'],
      ['09:58', '14:02'],
    ],
  )
  assert.ok(dubai.every((window) => window.days.length === 5), 'weekdays only')
})

test('the preset drifts in a DST zone, which is why the UI warns', () => {
  const january = presetWindowsFor('Europe/London', Date.UTC(2026, 0, 15, 12, 0))
  const july = presetWindowsFor('Europe/London', Date.UTC(2026, 6, 15, 12, 0))

  assert.equal(january[0].pauseAt, '00:58')
  assert.equal(july[0].pauseAt, '01:58')
  assert.notEqual(january[0].pauseAt, july[0].pauseAt)
})

test('a preset window evaluated in the pricing zone matches the converted one', () => {
  const reference = Date.UTC(2026, 8, 21, 12, 0)
  const dubaiWindow = presetWindowsFor('Asia/Dubai', reference)[0]

  const dubaiStart = wallToInstant('Asia/Dubai', 2026, 9, 21, parseHHMM(dubaiWindow.pauseAt))
  const beijingStart = wallToInstant('Asia/Shanghai', 2026, 9, 21, parseHHMM(DEEPSEEK_PEAK_PRESET.windows[0].pauseAt))

  assert.equal(dubaiStart, beijingStart, 'both describe the same instant')
})

test('every offered zone is a real zone', () => {
  const invalid = SCHEDULE_ZONE_CHOICES.filter((zone) => !isValidZone(zone))
  assert.deepEqual(invalid, [], 'an unknown identifier would be silently dropped from the picker')
})

test('the picker offers no duplicates', () => {
  assert.equal(new Set(SCHEDULE_ZONE_CHOICES).size, SCHEDULE_ZONE_CHOICES.length)
})

test('every whole-hour offset from -11 to +14 is offered, in winter and in summer', () => {
  // Two dates so the coverage cannot depend on which hemisphere is in daylight saving.
  for (const reference of [Date.UTC(2026, 0, 15), Date.UTC(2026, 6, 15)]) {
    const offered = new Set(SCHEDULE_ZONE_CHOICES.map((zone) => utcOffsetMinutes(zone, reference)))
    for (let hours = -11; hours <= 14; hours += 1) {
      assert.ok(
        offered.has(hours * 60),
        `nothing at UTC${hours >= 0 ? '+' : ''}${hours} on ${new Date(reference).toISOString().slice(0, 10)}`,
      )
    }
  }
})

test('the half- and quarter-hour offsets are offered too', () => {
  const required = [
    'America/St_Johns',
    'Asia/Tehran',
    'Asia/Kabul',
    'Asia/Kolkata',
    'Asia/Kathmandu',
    'Asia/Yangon',
    'Australia/Eucla',
    'Australia/Darwin',
    'Australia/Lord_Howe',
    'Pacific/Chatham',
  ]
  const missing = required.filter((zone) => !SCHEDULE_ZONE_CHOICES.includes(zone))
  assert.deepEqual(missing, [], 'these zones carry offsets no whole hour can express')
})

test('the half-hour offsets a user would look for are reachable by label', () => {
  const reference = Date.UTC(2026, 6, 15)
  const offered = new Set(SCHEDULE_ZONE_CHOICES.map((zone) => utcOffsetMinutes(zone, reference)))
  for (const minutes of [330, 345, 390, 525, 570, 630]) {
    assert.ok(offered.has(minutes), `nothing at ${formatOffset(minutes)} in July`)
  }
})

test('every zone carries a usable offset label', () => {
  for (const zone of SCHEDULE_ZONE_CHOICES) {
    assert.match(formatOffset(utcOffsetMinutes(zone, Date.now())), /^[+-]\d{2}:\d{2}$/)
  }
})

test('activeDays excludes weekends by default', () => {
  const saturday = at(SHANGHAI, 2026, 9, 26, '10:00')
  const state = computeState(saturday, config())
  assert.equal(state.state, 'NORMAL')
  assert.equal(state.reason, 'weekday-off')
})

test('computeState reports PAUSED inside a window with the resume instant', () => {
  const monday = mondayOfSeptember2026
  const inside = at(SHANGHAI, monday.y, monday.mo, monday.d, '10:00')
  const state = computeState(inside, config())

  assert.equal(state.state, 'PAUSED')
  assert.equal(state.reason, 'in-window')
  assert.equal(state.minutesUntilResume, 120)
  assert.equal(state.occurrenceId, `peak-am|${dayKey(monday.y, monday.mo, monday.d)}`)
  assert.equal(wallClock(SHANGHAI, new Date(state.resumeAt)).minutes, 720)
})

test('computeState reports WARN only inside the warning band', () => {
  const monday = mondayOfSeptember2026
  const soon = at(SHANGHAI, monday.y, monday.mo, monday.d, '08:56')
  const early = at(SHANGHAI, monday.y, monday.mo, monday.d, '08:50')

  assert.equal(computeState(soon, config()).state, 'WARN')
  assert.equal(computeState(soon, config()).minutesUntil, 4)
  assert.equal(computeState(early, config()).state, 'NORMAL')
  assert.equal(computeState(early, config()).reason, 'no-window')
})

test('computeState is inert when disabled or pointed at an unknown zone', () => {
  const monday = mondayOfSeptember2026
  const inside = at(SHANGHAI, monday.y, monday.mo, monday.d, '10:00')
  assert.equal(computeState(inside, config({ enabled: false })).reason, 'disabled')
  assert.equal(computeState(inside, config({ scheduleZone: 'Asia/Nowhere' })).reason, 'bad-zone')
})

test('nothing in the config can override an active window', () => {
  const monday = mondayOfSeptember2026
  const inside = at(SHANGHAI, monday.y, monday.mo, monday.d, '10:00')

  // The schedule is the only statement of when calls are held; there is no per-window
  // escape hatch left in the config, so an active window always reads as PAUSED.
  assert.equal(computeState(inside, config()).state, 'PAUSED')
  assert.equal(computeState(inside, config({ extra: 'ignored' })).state, 'PAUSED')
})

test('nextPause finds the next start and respects the weekday filter', () => {
  const monday = mondayOfSeptember2026
  const beforeDawn = at(SHANGHAI, monday.y, monday.mo, monday.d, '06:00')
  const found = nextPause(beforeDawn, config())
  assert.equal(wallClock(SHANGHAI, new Date(found.at)).minutes, 540)

  const afterWindow = at(SHANGHAI, monday.y, monday.mo, monday.d, '13:00')
  const tomorrow = nextPause(afterWindow, config())
  assert.ok(tomorrow.at > afterWindow)

  const saturday = at(SHANGHAI, 2026, 9, 26, '13:00')
  const next = nextPause(saturday, config())
  assert.equal(isoWeekday(wallClock(SHANGHAI, new Date(next.at)).weekday), 1, 'weekend rolls to Monday')
})

test('occurrenceId changes per day, so a dismissal never leaks into the next occurrence', () => {
  const window = { id: 'peak-am', pauseAt: '09:00' }
  assert.notEqual(occurrenceId(window, '2026-09-21'), occurrenceId(window, '2026-09-22'))
})

test('a spring-forward gap resolves to the first instant after the gap', () => {
  const instants = wallToInstants(NEW_YORK, 2026, 3, 8, parseHHMM('02:30'))
  assert.equal(instants.length, 0, '02:30 does not exist on this date')

  const resolved = wallToInstant(NEW_YORK, 2026, 3, 8, parseHHMM('02:30'))
  assert.equal(new Date(resolved).toISOString(), '2026-03-08T07:00:00.000Z')
})

test('a repeated wall time resolves to the earlier instant', () => {
  const instants = wallToInstants(NEW_YORK, 2026, 11, 1, parseHHMM('01:30'))
  assert.equal(instants.length, 2, '01:30 happens twice on this date')
  assert.equal(new Date(Math.min(...instants)).toISOString(), '2026-11-01T05:30:00.000Z')
  assert.equal(wallToInstant(NEW_YORK, 2026, 11, 1, parseHHMM('01:30')), Math.min(...instants))
})

test('a schedule keeps its wall-clock meaning across a DST change', () => {
  const before = wallToInstant(NEW_YORK, 2026, 3, 7, parseHHMM('09:00'))
  const after = wallToInstant(NEW_YORK, 2026, 3, 9, parseHHMM('09:00'))

  assert.equal(new Date(before).toISOString(), '2026-03-07T14:00:00.000Z')
  assert.equal(new Date(after).toISOString(), '2026-03-09T13:00:00.000Z')
  assert.equal(wallClock(NEW_YORK, new Date(before)).minutes, 540)
  assert.equal(wallClock(NEW_YORK, new Date(after)).minutes, 540)
})

test('the state machine agrees with the wall clock across a DST change', () => {
  const usConfig = config({ scheduleZone: NEW_YORK })
  const insideBefore = wallToInstant(NEW_YORK, 2026, 3, 6, parseHHMM('10:00'))
  const insideAfter = wallToInstant(NEW_YORK, 2026, 3, 10, parseHHMM('10:00'))

  assert.equal(computeState(insideBefore, usConfig).state, 'PAUSED')
  assert.equal(computeState(insideAfter, usConfig).state, 'PAUSED')
  assert.equal(computeState(insideAfter, usConfig).minutesUntilResume, 120)
})

test('half-hour and extreme offsets are handled', () => {
  assert.equal(wallClock('Asia/Kathmandu', new Date(Date.UTC(2026, 8, 21, 0, 0))).minutes, 345)
  const kiritimati = wallClock('Pacific/Kiritimati', new Date(Date.UTC(2026, 8, 21, 0, 0)))
  assert.equal(kiritimati.d, 21)
  assert.equal(kiritimati.minutes, 840)
  const auckland = wallToInstant('Pacific/Auckland', 2026, 9, 21, parseHHMM('09:00'))
  assert.equal(wallClock('Pacific/Auckland', new Date(auckland)).minutes, 540)
})
