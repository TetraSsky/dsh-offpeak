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
  // Only DeepSeek's own route has peak pricing; blocking others saves nothing.
  routeFilter: z.union([z.const('all'), z.const('deepseek-official')]).default('deepseek-official'),
  showBalance: z.boolean().default(false),
  // A forced code changes the symbol only; the rate below does the converting.
  currency: z.union([z.const('auto'), z.const('CNY'), z.const('USD')]).default('auto'),
  cnyPerUsd: z.number().min(0).default(0),
  showStatus: z.boolean().default(true),
})
