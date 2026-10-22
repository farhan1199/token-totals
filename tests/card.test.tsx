import { expect, test } from 'claude-code/testing'

const period = (label: string, days: number | null, tokens: number) => ({
  label, days, tokens, input: 1, output: 2, cacheWrite: 3, cacheRead: tokens - 6, sessions: 2,
  models: [{ name: 'claude-opus-5-5', tokens }],
})
const STDOUT = JSON.stringify({
  periods: [period('7 days', 7, 1_000_000), period('30 days', 30, 5_000_000), period('All time', null, 9_000_000)],
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
    await ui.press({ key: 'All time' })
    expect((await ui.find({ type: 'Text', text: /^9\.0M$/ }))?.text).toBe('9.0M')
    await ui.press({ key: '30 days' })
    await ui.unmount()
  }
})
