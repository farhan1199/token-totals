# token-totals

A Claude Code mod that shows how many tokens you've used in the last 7 days, the last 30 days and all time.

Type `/tokens` and a card appears in the chat with:

- filter buttons for 7 days, 30 days and all time
- the total for the chosen period, with sessions and a per-day average
- a breakdown into cache reads, cache writes, output and input
- the top models by tokens
- a Refresh button

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install token-totals --marketplace farhan1199/token-totals
```

Or from a shell:

```
claude plugin install token-totals --marketplace farhan1199/token-totals
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `farhan1199/token-totals`, then **Add plugin**.

## How it counts

The mod reads the session logs Claude Code keeps on your machine (`~/.claude/projects/**/*.jsonl`) and adds up the usage recorded on each reply, counting each reply once. Nothing is sent anywhere.

- It counts Claude Code use on **this machine only**: not claude.ai chats, and not other computers.
- "All time" goes back as far as your logs do; Claude Code removes old logs after `cleanupPeriodDays`.
- Totals include cache reads, which are most of the tokens in long sessions.

Needs `python3` on the machine.
