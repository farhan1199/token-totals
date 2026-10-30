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

// Claude's orange, from faint to full, for the heatmap and bars.
const HEAT = ['#5c3426', '#8f4a33', '#c2603f', '#e8845f']
const PARTS = [
  { key: 'cacheRead', label: 'Cache reads', color: '#d97757' },
  { key: 'cacheWrite', label: 'Cache writes', color: '#e9a98c' },
  { key: 'output', label: 'Output', color: '#6a9bcc' },
  { key: 'input', label: 'Input', color: '#9bb67c' },
] as const
const MODEL_COLORS = ['#d97757', '#6a9bcc', '#9bb67c', '#c99bd6']
// The Hobbit is about 95,000 words, roughly 127,000 tokens.
const HOBBIT = 127_000
const MAX_WEEKS = 26

const modelName = (id: string) => {
  const [family = id, ...rest] = id.replace(/^claude-/, '').split('-')
  return `${family[0]?.toUpperCase() ?? ''}${family.slice(1)} ${rest.join('.')}`.trim()
}

const hourName = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayName = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

// Weeks as columns, Sunday to Saturday, from the week of `first` to the week of
// `today`, the last `max` of them.
const weeks = (first: string, today: string, max: number) => {
  const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()
  const end = addDays(today, 6 - weekday(today))
  const span = Math.round((Date.parse(end) - Date.parse(addDays(first, -weekday(first)))) / 86_400_000) + 1
  const count = Math.min(max, Math.max(1, span / 7))
  return Array.from({ length: count }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(end, -(count - 1 - w) * 7 - (6 - d))))
}

// GitHub's contribution graph over the chosen period: small rounded squares, months
// across the top, Mon/Wed/Fri down the side, the legend under it, and the hovered
// day's line above, at the right. Gray at partial opacity reads on light and dark
// alike, since the SVG cannot see the app's theme.
// The SVG is always WIDTH wide, so the readout and legend stay put across filters;
// squares grow from 12px (44 weeks, about ten months) to 14px as the period shortens.
const WIDTH = 687
const SVG_WEEKS = 44
const GAP = 3
const MIN_CELL = 12
const MAX_CELL = 14
const LEFT = 30
const TOP = 34
const EMPTY = 'rgba(140,140,140,0.18)'
// Claude's orange at rising opacity, so the faintest day is also the lightest on either theme.
const SVG_HEAT = [0.3, 0.5, 0.75, 1].map(a => `rgba(217,119,87,${a})`)
const LABEL = 'rgba(140,140,140,0.95)'

const heatmap = (
  grid: string[][],
  shows: (day: string) => boolean,
  fill: (day: string) => string,
  readout: (day: string) => [when: string, tokens: string],
) => {
  const CELL = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor((WIDTH - LEFT + GAP) / grid.length) - GAP))
  const STEP = CELL + GAP
  const KEY = MIN_CELL + GAP
  const gridBottom = TOP + 7 * STEP - GAP
  const width = WIDTH
  const height = gridBottom + 8 + MIN_CELL
  const text = (x: number, y: number, s: string, anchor = 'start') =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}">${s}</text>`

  const months: string[] = []
  let lastAt = -Infinity
  grid.forEach((week, w) => {
    const month = Number(week[0]!.slice(5, 7))
    if (w > 0 && month === Number(grid[w - 1]![0]!.slice(5, 7))) return
    // A month label needs about 30px; drop the first if the next comes sooner.
    if ((w - lastAt) * STEP < 30) months.pop()
    months.push(text(LEFT + w * STEP, TOP - 6, MONTHS[month - 1]!))
    lastAt = w
  })
  const weekdays = [1, 3, 5].map(d => text(LEFT - 6, TOP + d * STEP + CELL - 2, WEEKDAYS[d]!, 'end'))
  // Hovering square #cN shows line #tN by CSS alone (a sibling selector): the SVG is
  // drawn in a frame without script, and the hover scopes of Boxes cannot reach inside it.
  const lines: string[] = []
  const cells = grid.flatMap((week, w) => week.filter(shows).map(day => {
    const d = new Date(`${day}T00:00:00Z`).getUTCDay()
    const [when, tokens] = readout(day)
    lines.push(`<text id="t${lines.length}" class="r" x="${width}" y="12" text-anchor="end">`
      + `${when} · <tspan class="v">${tokens}</tspan></text>`)
    return `<rect id="c${lines.length - 1}" x="${LEFT + w * STEP}" y="${TOP + d * STEP}" width="${CELL}" height="${CELL}" rx="${CELL > 14 ? 3 : 2}" fill="${fill(day)}"/>`
  }))
  const shown = lines.map((_, i) => `#c${i}:hover~#t${i}`).join(',')
  const swatches = [EMPTY, ...SVG_HEAT]
  const legendX = width - swatches.length * KEY - 30
  const legendY = gridBottom + 8
  const legend = [
    text(legendX - 6, legendY + MIN_CELL - 2, 'Less', 'end'),
    ...swatches.map((color, i) =>
      `<rect class="key" x="${legendX + i * KEY}" y="${legendY}" width="${MIN_CELL}" height="${MIN_CELL}" rx="2" fill="${color}"/>`),
    text(legendX + swatches.length * KEY + 3, legendY + MIN_CELL - 2, 'More'),
  ]

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<style>text{font:10px -apple-system,system-ui,sans-serif;fill:${LABEL}}`
    + `rect[id]:hover{stroke:#d97757;stroke-width:1.5}`
    + `.r{display:none;font-size:11px}.v{font-weight:600;fill:#d97757}`
    + (shown ? `${shown}{display:inline}` : '') + '</style>'
    + months.join('') + weekdays.join('') + cells.join('') + lines.join('') + legend.join('')
    + '</svg>'
}

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

    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // Surfaces that draw SVG get GitHub-style small squares; the terminal gets a box grid.
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    const choice = await read($, selected)
    const p: Period = t.periods.find(one => one.label === choice) ?? t.periods[t.periods.length - 1]!

    const first = p.days ? addDays(t.today, 1 - p.days) : (t.since ?? t.today)
    const inPeriod = (day: string) => day >= first && day <= t.today
    const activeDays = Object.entries(t.daily).filter(([day, n]) => n > 0 && inPeriod(day)).length
    // The grid spans the chosen period, a week per column; days outside it are not drawn.
    const peak = p.hours.indexOf(Math.max(...p.hours))
    const top = p.models[0]
    const grid = weeks(first, t.today, Svg ? SVG_WEEKS : MAX_WEEKS)
    const busiest = Math.max(1, ...grid.flat().filter(inPeriod).map(day => t.daily[day] ?? 0))
    const heat = (day: string, scale: string[]) => {
      const n = t.daily[day] ?? 0
      if (!inPeriod(day) || n === 0) return undefined
      return scale[Math.min(scale.length - 1, Math.floor((n / busiest) * scale.length))]
    }
    const readout = (day: string): [string, string] =>
      [dayName(day), t.daily[day] ? `${short(t.daily[day])} tokens` : 'No activity']
    const tiles: [string, string][] = [
      ['Sessions', p.sessions.toLocaleString()],
      ['Replies', p.replies.toLocaleString()],
      ['Active days', `${activeDays}`],
      ['Peak hour', p.replies ? hourName(peak) : '—'],
      ['Per active day', activeDays ? short(Math.round(p.tokens / activeDays)) : '—'],
      ['Favorite model', top ? modelName(top.name) : '—'],
    ]
    const hobbits = Math.round(p.tokens / HOBBIT)

    return (
      <Box flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={2} paddingY={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
          <Box flexDirection="column">
            <Text dimColor size="footnote">Total tokens · {p.label === 'All time' ? 'all time' : `last ${p.label}`}</Text>
            <Text size="title" weight="bold" bold tabular color="claude">{short(p.tokens)}</Text>
            {hobbits > 0 && <Text dimColor size="footnote">≈ {hobbits.toLocaleString()}× the length of The Hobbit</Text>}
          </Box>
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

        {[tiles.slice(0, 3), tiles.slice(3)].map((row, i) => (
          <Box key={`tiles-${i}`} flexDirection="row" gap={1}>
            {row.map(([label, value]) => (
              <Box key={label} flexDirection="column" flexGrow={1} width={1} borderStyle="round" borderDimColor paddingX={1}>
                <Text dimColor size="footnote">{label}</Text>
                <Text weight="semibold" bold tabular>{value}</Text>
              </Box>
            ))}
          </Box>
        ))}

        {Svg ? (
          <Box flexDirection="column" gap="xs">
            <Text weight="semibold" bold>Activity</Text>
            <Svg
              source={heatmap(grid, inPeriod, day => heat(day, SVG_HEAT) ?? EMPTY, readout)}
              alt={`Daily tokens over ${p.label === 'All time' ? 'all time' : `the last ${p.label}`}, ${activeDays} active days`}
              isInteractive
            />
          </Box>
        ) : (
          <Box flexDirection="column" gap="xs">
            {/* Hovering a day reveals its line here, beside the heading, by a shared hover scope:
                a card over the grid would paint under the columns drawn after it. */}
            <Box flexDirection="row" justifyContent="space-between" alignItems="center">
              <Text weight="semibold" bold>Activity</Text>
              {grid.flat().filter(inPeriod).map(day => (
                <Box key={`info-${day}`} display="none" hover={{ scope: `day-${day}`, display: 'flex' }}>
                  <Text dimColor size="footnote">{dayName(day)} · </Text>
                  <Text weight="semibold" bold tabular size="footnote">
                    {t.daily[day] ? `${short(t.daily[day])} tokens` : 'No activity'}
                  </Text>
                </Box>
              ))}
            </Box>
            {/* Two columns by one row is about square in a terminal cell. */}
            <Box flexDirection="row" gap="xs">
              <Box flexDirection="column" width={4}>
                {WEEKDAYS.map((name, d) => <Text key={name} dimColor>{d % 2 ? name : ' '}</Text>)}
              </Box>
              {grid.map((week, w) => (
                <Box key={`w${w}`} flexDirection="column">
                  {week.map(day => (
                    <Box
                      key={day}
                      width={2}
                      height={1}
                      backgroundColor={heat(day, HEAT) ?? (inPeriod(day) ? 'subtle' : undefined)}
                      hover={inPeriod(day) ? { scope: `day-${day}`, backgroundColor: 'claude' } : undefined}
                    />
                  ))}
                </Box>
              ))}
            </Box>
            <Box flexDirection="row" gap="xs" alignItems="center">
              <Text dimColor size="caption">Less</Text>
              {HEAT.map(color => <Box key={color} width={2} height={1} backgroundColor={color} />)}
              <Text dimColor size="caption">More</Text>
            </Box>
          </Box>
        )}

        <Box flexDirection="column" gap="xs">
          <Text weight="semibold" bold>Where the tokens went</Text>
          <Box flexDirection="row" width="100%" height={1}>
            {/* the first part fills what the rounded others leave, so the bar never overflows */}
            {PARTS.filter(part => p[part.key] > 0).map((part, i) => (
              <Box
                key={part.key}
                {...(i === 0 ? { flexGrow: 1 } : { width: `${Math.max(1, Math.round((p[part.key] / p.tokens) * 100))}%` })}
                height={1}
                backgroundColor={part.color}
              />
            ))}
          </Box>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {PARTS.map(part => (
              <Text key={part.key}>
                <Text color={part.color}>●</Text> {part.label} <Text dimColor tabular>{short(p[part.key])} · {pct(p[part.key], p.tokens)}</Text>
              </Text>
            ))}
          </Box>
        </Box>

        {p.models.length > 0 && (
          <Box flexDirection="column" gap="xs">
            <Text weight="semibold" bold>By model</Text>
            {p.models.map((m, i) => (
              <Box key={m.name} flexDirection="row" alignItems="center" gap={1}>
                <Box width={16}><Text>{modelName(m.name)}</Text></Box>
                <Box flexGrow={1} height={1} flexDirection="row">
                  <Box width={`${Math.max(1, Math.round((m.tokens / (top?.tokens || 1)) * 100))}%`} height={1} backgroundColor={MODEL_COLORS[i % MODEL_COLORS.length]} />
                </Box>
                <Box width={14} justifyContent="flex-end">
                  <Text tabular dimColor>{short(m.tokens)} · {pct(m.tokens, p.tokens)}</Text>
                </Box>
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
