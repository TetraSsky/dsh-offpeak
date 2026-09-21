import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

const CAPACITY = 288

// Bumped when a stored file's meaning changes; v1 could hold another plugin's samples, so it is dropped.
const HISTORY_VERSION = 2

export const HISTORY_FILE = 'offpeak-history.json'

const isSample = (value) => Number.isFinite(value?.at) && Number.isFinite(value?.total)

// A capped ring of this plugin's own samples, written temp-and-rename under the harness home.
export const createHistory = ({ report = () => {}, filePath = dshHomePath(HISTORY_FILE) } = {}) => {
  let samples = []

  const persist = () => {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      const temporary = `${filePath}.tmp`
      writeFileSync(temporary, JSON.stringify({ version: HISTORY_VERSION, samples }, null, 2))
      renameSync(temporary, filePath)
    } catch (error) {
      report('history persist failed', { message: String((error && error.message) || error) })
    }
  }

  const load = () => {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
      if (parsed?.version === HISTORY_VERSION && Array.isArray(parsed.samples)) {
        samples = parsed.samples
          .filter(isSample)
          .sort((left, right) => left.at - right.at)
          .slice(-CAPACITY)
      } else if (parsed?.version !== undefined) {
        report('history discarded', { found: parsed.version, expected: HISTORY_VERSION })
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        report('history load failed', { message: String((error && error.message) || error) })
      }
    }
    return samples
  }

  return {
    load,
    all: () => samples,
    get size() {
      return samples.length
    },
    get path() {
      return filePath
    },
    record(total, at = Date.now()) {
      if (!Number.isFinite(total)) return
      const last = samples[samples.length - 1]
      if (last && last.at === at) {
        last.total = total
        return
      }
      samples.push({ at, total })
      if (samples.length > CAPACITY) samples = samples.slice(-CAPACITY)
      persist()
    },
  }
}
