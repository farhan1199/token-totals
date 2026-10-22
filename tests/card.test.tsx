import { expect, test } from 'claude-code/testing'

const period = (label: string, days: number | null, tokens: number) => ({
  label, days, tokens, input: 1, output: 2, cacheWrite: 3, cacheRead: tokens - 6, sessions: 2,
  replies: 10, hours: Array.from({ length: 24 }, (_, h) => (h === 11 ? 5 : 0)),
  models: [{ name: 'claude-opus-5-5', tokens }],
})
const STDOUT = JSON.stringify({
  periods: [period('7 days', 7, 1_000_000), period('30 days', 30, 5_000_000), period('All time', null, 9_000_000)],
  daily: { '2026-10-20': 400_000, '2026-10-21': 600_000 },
  today: '2026-10-22',
  since: '2026-06-17',
})

test('the /tokens card switches period when a filter is pressed', async ($, on) => {
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: STDOUT, stderr: '' } }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'tokens', args: '' })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: 'token-totals',
      component: 'CommandOutput',
      surface,
      props: { command: 'tokens', args: '', text: 'x', isErrored: false },
    })
    expect((await ui.find({ type: 'Text', text: /^5\.0M$/ }))?.text).toBe('5.0M')
    expect((await ui.find({ type: 'Text', text: /^11 AM$/ }))?.text).toBe('11 AM')
    expect((await ui.find({ type: 'Text', text: /^Opus 5\.5$/ }))?.text).toBe('Opus 5.5')
    // The day's hover card is hidden until hovered, so check its cell is drawn.
    expect(await ui.find({ key: '2026-10-21' })).toBeDefined()
    await ui.press({ key: 'All time' })
    expect((await ui.find({ type: 'Text', text: /^9\.0M$/ }))?.text).toBe('9.0M')
    await ui.press({ key: '30 days' })
    await ui.unmount()
  }
})

test('falls back to python when python3 fails, as on Windows', async ($, on) => {
  const tried: string[] = []
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    tried.push(e.argv[0]!)
    return e.argv[0] === 'python3'
      ? { value: { exitCode: 9009, stdout: '', stderr: 'Python was not found' } }
      : { value: { exitCode: 0, stdout: STDOUT, stderr: '' } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({ command: 'tokens', args: '' })
  expect(JSON.stringify(ran)).toContain('5.0M')
  expect(tried.slice(0, 2)).toEqual(['python3', 'python'])
})

