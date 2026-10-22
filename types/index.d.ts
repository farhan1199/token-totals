export type Period = {
  label: string
  days: number | null
  tokens: number
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  sessions: number
  models: { name: string; tokens: number }[]
}
export type Totals = { periods: Period[]; since: string | null; checkedAt: string } | { error: string } | null

declare module 'claude-code' {
  interface PluginState {
    'token-totals': { totals: Totals; selected: string }
  }
}
