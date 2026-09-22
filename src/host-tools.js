import { defineTool } from '@deepseek-ai/dsh-tools'
import { computeState, formatHHMM, wallClock } from './core.js'

const TOOL_NAME = 'offpeak_status'

// Read-only: tells the model why calls are held.
export const createStatusTool = ({ getConfig, getPending = () => 0 }) => {
  const snapshot = () => {
    const config = getConfig()
    const state = computeState(Date.now(), config)
    const zone = config.scheduleZone

    const resumesAt =
      state.state === 'PAUSED' && state.resumeAt
        ? formatHHMM(wallClock(zone, new Date(state.resumeAt)).minutes)
        : undefined

    return {
      enabled: config.enabled === true,
      state: state.state,
      reason: state.reason,
      scheduleZone: zone,
      windows: (config.windows ?? []).map((window) => ({
        pauseAt: window.pauseAt,
        resumeAt: window.resumeAt,
        days: [...(window.days ?? [])],
      })),
      ...(resumesAt === undefined ? {} : { resumesAt }),
      heldRequests: getPending(),
    }
  }

  const render = (_args, value) => {
    if (!value.enabled) return [{ type: 'text', text: 'Off-peak pause is disabled, so model calls are never held.' }]

    const schedule = value.windows.length
      ? value.windows.map((window) => `${window.pauseAt}-${window.resumeAt}`).join(', ')
      : 'none configured'

    const lines = []
    if (value.state === 'PAUSED') {
      lines.push(
        `Model calls are being held until ${value.resumesAt ?? 'the window ends'} (${value.scheduleZone}) to avoid DeepSeek peak pricing.`,
      )
      if (value.heldRequests > 0) lines.push(`${value.heldRequests} request(s) are currently waiting.`)
    } else if (value.state === 'WARN') {
      lines.push(`Peak pricing starts within ${value.minutesUntil ?? 'a few'} minutes; calls will then be held.`)
    } else {
      lines.push(`No pause is active (${value.reason}).`)
    }
    lines.push(`Schedule (${value.scheduleZone}): ${schedule}.`)
    lines.push('This is a read-only report; the schedule can only be changed by the user in Settings.')
    return [{ type: 'text', text: lines.join(' ') }]
  }

  return defineTool({
    name: TOOL_NAME,
    description:
      'Report the off-peak pause schedule and whether model calls are currently being held. Read-only: it cannot change the schedule.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean', required: true },
          state: { type: 'string', required: true, enum: ['NORMAL', 'WARN', 'PAUSED'] },
          reason: { type: 'string', required: true },
          scheduleZone: { type: 'string', required: true },
          windows: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                pauseAt: { type: 'string', required: true },
                resumeAt: { type: 'string', required: true },
                days: { type: 'array', required: true, items: { type: 'integer' } },
              },
            },
          },
          resumesAt: { type: 'string' },
          heldRequests: { type: 'integer', required: true },
        },
      },
      render,
    },
    execute() {
      return Promise.resolve(snapshot())
    },
  })
}
