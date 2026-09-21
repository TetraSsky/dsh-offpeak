const MINUTES_PER_DAY = 1440
const formatters = new Map()

const formatterFor = (zone) => {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    formatters.set(zone, formatter)
  }
  return formatter
}

export const isValidZone = (zone) => {
  if (typeof zone !== 'string' || zone.length === 0) return false
  try {
    formatterFor(zone).format(new Date())
    return true
  } catch {
    return false
  }
}

export const parseHHMM = (value) => {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export const formatHHMM = (minutes) => {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

// Renders a UTC offset the way zones are usually labelled: `+08:00`, `-05:00`, `+05:45`.
export const formatOffset = (minutes) => {
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(Math.round(minutes))
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
}

export const wallClock = (zone, date) => {
  const parts = {}
  for (const part of formatterFor(zone).formatToParts(date)) parts[part.type] = part.value
  const y = Number(parts.year)
  const mo = Number(parts.month)
  const d = Number(parts.day)
  // Some ICU builds render midnight as hour "24"; folding keeps minutes in range.
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute)
  return { y, mo, d, weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(), minutes }
}

export const isoWeekday = (weekday) => (weekday === 0 ? 7 : weekday)

export const dayKey = (y, mo, d) =>
  `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`

const addDays = (y, mo, d, delta) => {
  const shifted = new Date(Date.UTC(y, mo - 1, d + delta))
  return { y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() }
}

// Every instant whose wall-clock reading in `zone` equals the requested one: none is a DST gap, two is a repeat.
export const wallToInstants = (zone, y, mo, d, minutes) => {
  const naive = Date.UTC(y, mo - 1, d) + minutes * 60000

  // Sampled across a few days so both sides of a daylight-saving change are seen.
  const offsets = new Set()
  for (const day of [-2, -1, 0, 1, 2]) {
    offsets.add(utcOffsetMinutes(zone, naive + day * MINUTES_PER_DAY * 60000))
  }

  const found = []
  for (const offset of offsets) {
    const candidate = naive - offset * 60000
    const wc = wallClock(zone, new Date(candidate))
    if (wc.y === y && wc.mo === mo && wc.d === d && wc.minutes === minutes) found.push(candidate)
  }
  return found
}

// Resolve a wall-clock reading to one instant: a gap resolves past the gap, a repeat to the earlier instant.
export const wallToInstant = (zone, y, mo, d, minutes) => {
  const found = wallToInstants(zone, y, mo, d, minutes)
  if (found.length > 0) return Math.min(...found)
  for (let step = 1; step <= 180; step += 1) {
    const after = wallToInstants(zone, y, mo, d, minutes + step)
    if (after.length > 0) return Math.min(...after)
  }
  return null
}

// Half-open [pauseAt, resumeAt); a midnight-crossing window belongs to the day it started.
export const windowMatchesAt = (window, wall, activeDays) => {
  const pauseAt = parseHHMM(window.pauseAt)
  const resumeAt = parseHHMM(window.resumeAt)
  if (pauseAt === null || resumeAt === null || pauseAt === resumeAt) return false

  const crossesMidnight = pauseAt > resumeAt
  const inWindow = crossesMidnight
    ? wall.minutes >= pauseAt || wall.minutes < resumeAt
    : wall.minutes >= pauseAt && wall.minutes < resumeAt
  if (!inWindow) return false

  const startedToday = !crossesMidnight || wall.minutes >= pauseAt
  const startWeekday = startedToday
    ? isoWeekday(wall.weekday)
    : isoWeekday((wall.weekday + 6) % 7)

  if (Array.isArray(window.days) && window.days.length > 0) {
    return window.days.includes(startWeekday)
  }
  return !Array.isArray(activeDays) || activeDays.length === 0 || activeDays.includes(startWeekday)
}

const startOfWindowOnDay = (zone, y, mo, d, pauseAt) => {
  const at = wallToInstant(zone, y, mo, d, pauseAt)
  return at === null ? null : { at, day: dayKey(y, mo, d) }
}

// The next pause at or after now, scanning a few days so sparse weekdays are still found.
export const nextPause = (now, config, limitDays = 8) => {
  const zone = config.scheduleZone
  if (!isValidZone(zone)) return null
  const wall = wallClock(zone, now)
  let best = null

  for (let delta = 0; delta <= limitDays; delta += 1) {
    const day = addDays(wall.y, wall.mo, wall.d, delta)
    const weekday = isoWeekday(new Date(Date.UTC(day.y, day.mo - 1, day.d)).getUTCDay())
    if (Array.isArray(config.activeDays) && config.activeDays.length > 0 && !config.activeDays.includes(weekday)) {
      continue
    }
    for (const window of config.windows ?? []) {
      if (Array.isArray(window.days) && window.days.length > 0 && !window.days.includes(weekday)) continue
      const pauseAt = parseHHMM(window.pauseAt)
      if (pauseAt === null) continue
      const start = startOfWindowOnDay(zone, day.y, day.mo, day.d, pauseAt)
      if (!start || start.at < now) continue
      if (!best || start.at < best.at) best = { window, at: start.at, day: start.day }
    }
    if (best && delta > 0) break
  }

  return best
}

// Offset of `zone` from UTC at one instant, in minutes.
export const utcOffsetMinutes = (zone, instant) => {
  const date = new Date(Math.floor(instant / 60000) * 60000)
  const wall = wallClock(zone, date)
  const asUTC = Date.UTC(wall.y, wall.mo - 1, wall.d, Math.floor(wall.minutes / 60), wall.minutes % 60)
  return Math.round((asUTC - date.getTime()) / 60000)
}

// Whether a zone shifts its offset during the year, which decides if it can pin a fixed peak.
export const observesDST = (zone, year = new Date().getUTCFullYear()) => {
  if (!isValidZone(zone)) return false
  const january = utcOffsetMinutes(zone, Date.UTC(year, 0, 15))
  const july = utcOffsetMinutes(zone, Date.UTC(year, 6, 15))
  return january !== july
}

// Re-express a wall-clock time in another zone, holding the instant fixed at `reference`.
export const convertHHMM = (fromZone, toZone, value, reference = Date.now()) => {
  const minutes = parseHHMM(value)
  if (minutes === null || !isValidZone(fromZone) || !isValidZone(toZone)) return value
  const at = new Date(reference)
  const wall = wallClock(fromZone, at)
  const instant = wallToInstant(fromZone, wall.y, wall.mo, wall.d, minutes)
  if (instant === null) return value
  return formatHHMM(wallClock(toZone, new Date(instant)).minutes)
}

// Peak rates are 09:00-12:00 and 14:00-18:00 Beijing on weekdays; the margin avoids boundary slip.
export const DEEPSEEK_PEAK_PRESET = {
  zone: 'Asia/Shanghai',
  days: [1, 2, 3, 4, 5],
  windows: [
    { id: 'peak-am', pauseAt: '08:58', resumeAt: '12:02' },
    { id: 'peak-pm', pauseAt: '13:58', resumeAt: '18:02' },
  ],
}

// The preset expressed in `targetZone`, so the user's chosen zone is never overridden.
export const presetWindowsFor = (targetZone, reference = Date.now()) =>
  DEEPSEEK_PEAK_PRESET.windows.map((window) => ({
    ...window,
    pauseAt: convertHHMM(DEEPSEEK_PEAK_PRESET.zone, targetZone, window.pauseAt, reference),
    resumeAt: convertHHMM(DEEPSEEK_PEAK_PRESET.zone, targetZone, window.resumeAt, reference),
    days: [...DEEPSEEK_PEAK_PRESET.days],
  }))

// Every whole-hour offset from -11 to +14 plus the half- and quarter-hour ones, so any user has a zone.
export const SCHEDULE_ZONE_CHOICES = [
  'Pacific/Pago_Pago',
  'Pacific/Honolulu',
  'Pacific/Gambier',
  'America/Anchorage',
  'Pacific/Pitcairn',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Chicago',
  'Pacific/Galapagos',
  'America/New_York',
  'America/Bogota',
  'America/Halifax',
  'America/Caracas',
  'America/St_Johns',
  'America/Sao_Paulo',
  'America/Noronha',
  'Atlantic/Azores',
  'Atlantic/Cape_Verde',
  'UTC',
  'Europe/London',
  'Africa/Accra',
  'Europe/Paris',
  'Africa/Lagos',
  'Europe/Athens',
  'Africa/Johannesburg',
  'Europe/Moscow',
  'Africa/Nairobi',
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Baku',
  'Asia/Kabul',
  'Asia/Karachi',
  'Asia/Yekaterinburg',
  'Asia/Kolkata',
  'Asia/Colombo',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Omsk',
  'Asia/Yangon',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Makassar',
  'Australia/Eucla',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Darwin',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Australia/Lord_Howe',
  'Pacific/Guadalcanal',
  'Pacific/Noumea',
  'Asia/Kamchatka',
  'Pacific/Auckland',
  'Pacific/Chatham',
  'Pacific/Tongatapu',
  'Pacific/Kiritimati',
]

export const occurrenceId = (window, day) => `${window.id || window.pauseAt}|${day}`

// The schedule decision, shared by host and client so the notice and the gate cannot disagree.
export const computeState = (now, config) => {
  if (!config || !config.enabled) return { state: 'NORMAL', reason: 'disabled' }

  const zone = config.scheduleZone
  if (!isValidZone(zone)) return { state: 'NORMAL', reason: 'bad-zone' }

  const wall = wallClock(zone, now)
  const today = dayKey(wall.y, wall.mo, wall.d)

  for (const window of config.windows ?? []) {
    if (!windowMatchesAt(window, wall, config.activeDays)) continue
    const id = occurrenceId(window, today)
    const resumeAt = parseHHMM(window.resumeAt)
    const pauseAt = parseHHMM(window.pauseAt)
    // A midnight-crossing window's evening half resumes tomorrow; its early-morning half resumes today.
    const resumeDay =
      pauseAt > resumeAt && wall.minutes >= pauseAt
        ? addDays(wall.y, wall.mo, wall.d, 1)
        : { y: wall.y, mo: wall.mo, d: wall.d }
    const resumeAtInstant = wallToInstant(zone, resumeDay.y, resumeDay.mo, resumeDay.d, resumeAt)
    return {
      state: 'PAUSED',
      reason: 'in-window',
      window,
      occurrenceId: id,
      resumeAt: resumeAtInstant,
      minutesUntilResume: resumeAtInstant === null ? null : Math.ceil((resumeAtInstant - now) / 60000),
    }
  }

  // Checked after the windows so a window that started yesterday still wins.
  if (Array.isArray(config.activeDays) && config.activeDays.length > 0) {
    if (!config.activeDays.includes(isoWeekday(wall.weekday))) {
      return { state: 'NORMAL', reason: 'weekday-off' }
    }
  }

  const upcoming = nextPause(now, config)
  if (upcoming) {
    const minutesUntil = Math.ceil((upcoming.at - now) / 60000)
    if (minutesUntil <= config.warnMinutes) {
      const id = occurrenceId(upcoming.window, upcoming.day)
      return {
        state: 'WARN',
        reason: 'approaching',
        window: upcoming.window,
        occurrenceId: id,
        startsAt: upcoming.at,
        minutesUntil,
      }
    }
  }

  return { state: 'NORMAL', reason: 'no-window' }
}
