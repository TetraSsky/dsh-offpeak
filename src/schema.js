import z from '@deepseek-ai/schemastery'

export const NS = 'offpeak'

export const Window = z.object({
  id: z.string().default(''),
  pauseAt: z.string().default('09:00'),
  resumeAt: z.string().default('12:00'),
  days: z.array(z.number()).default([1, 2, 3, 4, 5]),
})

export const Config = z.object({
  enabled: z.boolean().default(false),
  scheduleZone: z.string().default('Asia/Shanghai'),
  displayZone: z.string().default('schedule'),
  windows: z.array(Window).default([]),
  activeDays: z.array(z.number()).default([1, 2, 3, 4, 5]),
  warnMinutes: z.number().min(0).default(5),
  // Peak pricing only exists on DeepSeek's own route, so blocking anything else would cost time and save nothing.
  routeFilter: z.union([z.const('all'), z.const('deepseek-official')]).default('deepseek-official'),
  showBalance: z.boolean().default(false),
  showStatus: z.boolean().default(true),
})
