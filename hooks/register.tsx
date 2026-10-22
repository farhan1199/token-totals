import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Period, Totals } from '../types'

const totals = atom({ plugin: 'token-totals', key: 'totals' } as const, null as Totals)
const selected = atom({ plugin: 'token-totals', key: 'selected' } as const, '30 days')

const short = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B`
  : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K`
  : `${n}`

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '0%')

// `python3` is missing on most Windows machines (or is the Microsoft Store
// placeholder), where `python` or the `py` launcher is the real one.
const PYTHONS = [['python3'], ['python'], ['py', '-3']]
let python: string[] | undefined

const count = async ($: EngineInterface, argv: string[]) => {
  const { exitCode, stdout, stderr } = await $.process.run(
    [...argv, '-I', `${$.plugin.root}/scripts/usage.py`],
    { timeoutMs: 120_000 },
  )
  if (exitCode !== 0) throw new Error(stderr.trim() || `exit ${exitCode}`)
  return JSON.parse(stdout)
}

const refresh = async ($: EngineInterface) => {
  let next: Totals = { error: 'Python 3 was not found. Install it from python.org.' }
  for (const argv of python ? [python] : PYTHONS) {
    try {
      next = { ...(await count($, argv)), checkedAt: new Date().toLocaleTimeString() }
      python = argv
      break
    } catch (err) {
      if (python) next = { error: String(err) }
    }
  }
  await update($, totals, () => next)
  return next
}

const summary = (t: Totals) =>
  !t ? 'Not counted yet.'
  : 'error' in t ? `Could not count tokens: ${t.error}`
  : t.periods.map(p => `${p.label}: ${short(p.tokens)} tokens (${p.sessions} sessions)`).join('\n')
    + (t.since ? `\nLogs start ${t.since}.` : '')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Show your token totals: last 7 days, 30 days, all time',
    })
    void refresh($)

    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => ({ text: summary(await refresh($)) }))

  on('ui.render', { component: 'CommandOutput', props: { command: 'tokens' } }, async ($, e, next) => {
    const t = await read($, totals)
    if (!t || 'error' in t || e.props.isErrored) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const choice = await read($, selected)
    const p: Period = t.periods.find(one => one.label === choice) ?? t.periods[t.periods.length - 1]!
    const fresh = p.input + p.output
    const rows: [string, number][] = [
      ['Cache reads', p.cacheRead],
      ['Cache writes', p.cacheWrite],
      ['Output', p.output],
      ['Input', p.input],
    ]

    return (
      <Box flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={2} paddingY={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Text weight="semibold" bold>Token usage</Text>
          <Box flexDirection="row" gap={1}>
            {t.periods.map(one => (
              <Button
                key={one.label}
                variant={one.label === p.label ? 'primary' : 'secondary'}
                onPress={() => update($, selected, () => one.label)}
              >
                {one.label}
              </Button>
            ))}
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text size="title" weight="bold" bold tabular>{short(p.tokens)}</Text>
          <Text dimColor>
            tokens · {p.sessions} sessions
            {p.days ? ` · ~${short(Math.round(p.tokens / p.days))}/day` : ''}
            {' · '}{short(fresh)} new input + output
          </Text>
        </Box>

        <Box flexDirection="column">
          {rows.map(([label, n]) => (
            <Box key={label} flexDirection="row" justifyContent="space-between">
              <Text>{label}</Text>
              <Text tabular dimColor>{short(n)} · {pct(n, p.tokens)}</Text>
            </Box>
          ))}
        </Box>

        {p.models.length > 0 && (
          <Box flexDirection="column">
            <Text weight="semibold" bold>By model</Text>
            {p.models.map(m => (
              <Box key={m.name} flexDirection="row" justifyContent="space-between">
                <Text mono>{m.name}</Text>
                <Text tabular dimColor>{short(m.tokens)} · {pct(m.tokens, p.tokens)}</Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Text dimColor size="caption">
            From Claude Code logs{t.since ? ` since ${t.since}` : ''} · updated {t.checkedAt}
          </Text>
          <Button key="refresh" variant="secondary" onPress={() => void refresh($)}>Refresh</Button>
        </Box>
      </Box>
    )
  })
}
