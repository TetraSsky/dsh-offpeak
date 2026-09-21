export const BUCKET_MS = 10 * 60 * 1000
export const WINDOW_BUCKETS = 48

const isDrop = (previous, sample) => previous !== null && sample.total < previous.total

// Spend is the sum of balance drops, so a top-up cannot cancel out real spend.
export const spendInWindow = (samples, now, windowMs) => {
  const from = now - windowMs
  let spend = 0
  let previous = null
  for (const sample of samples) {
    if (sample.at < from) {
      previous = sample
      continue
    }
    if (isDrop(previous, sample)) spend += previous.total - sample.total
    previous = sample
  }
  return spend
}

// One bar per bucket, oldest first; null marks a bucket with no sample at all.
export const spendBars = (samples, now, buckets = WINDOW_BUCKETS, bucketMs = BUCKET_MS) => {
  const bars = new Array(buckets).fill(null)
  let previous = null

  for (const sample of samples) {
    if (isDrop(previous, sample)) {
      const index = buckets - 1 - Math.floor((now - sample.at) / bucketMs)
      if (index >= 0 && index < buckets) bars[index] = (bars[index] ?? 0) + (previous.total - sample.total)
    }
    previous = sample
  }

  return bars
}

export const bucketLabel = (index, now, buckets = WINDOW_BUCKETS, bucketMs = BUCKET_MS) => {
  const at = now - (buckets - 1 - index) * bucketMs
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export const formatClock = (instant) => {
  const date = new Date(instant)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// The `HH:MM-HH:MM` span a spend window covers, for the hover breakdown.
export const windowRangeLabel = (now, windowMs) => `${formatClock(now - windowMs)}-${formatClock(now)}`
