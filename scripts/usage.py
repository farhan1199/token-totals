import json, glob, os, datetime as dt
now = dt.datetime.now(dt.timezone.utc)
periods = [('7 days', 7), ('30 days', 30), ('All time', None)]
fields = ('input', 'output', 'cacheWrite', 'cacheRead')
keys = ('input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens')

# One reply is logged as a line per part (thinking, text, tool call), each
# repeating the reply's usage, so count each reply once, at its largest
# values (output can grow while the reply streams).
replies = {}
for f in glob.glob(os.path.expanduser('~/.claude/projects/**/*.jsonl'), recursive=True):
    try:
        lines = open(f, encoding='utf-8', errors='ignore')
    except OSError:
        continue
    for l in lines:
        try:
            r = json.loads(l)
        except ValueError:
            continue
        m = r.get('message')
        u = m.get('usage') if isinstance(m, dict) else None
        ts = r.get('timestamp')
        if not u or not ts:
            continue
        vals = [u.get(k) or 0 for k in keys]
        key = (m.get('id'), r.get('requestId'))
        seen = replies.get(key)
        if seen:
            seen['vals'] = [max(a, b) for a, b in zip(seen['vals'], vals)]
            continue
        replies[key] = {'vals': vals, 'ts': ts, 'model': m.get('model') or 'unknown', 'session': r.get('sessionId')}

tot = {l: {'days': d, **{f: 0 for f in fields}, 'sessions': set(), 'models': {}} for l, d in periods}
first = None
for reply in replies.values():
    t = dt.datetime.fromisoformat(reply['ts'].replace('Z', '+00:00'))
    first = t if first is None or t < first else first
    vals = dict(zip(fields, reply['vals']))
    age = (now - t).days
    for label, lim in periods:
        if lim is None or age < lim:
            p = tot[label]
            for k, v in vals.items():
                p[k] += v
            p['sessions'].add(reply['session'])
            p['models'][reply['model']] = p['models'].get(reply['model'], 0) + sum(vals.values())
out = []
for label, p in tot.items():
    models = sorted(p['models'].items(), key=lambda kv: -kv[1])
    out.append({'label': label, 'days': p['days'], **{f: p[f] for f in fields},
                'tokens': sum(p[f] for f in fields), 'sessions': len(p['sessions']),
                'models': [{'name': n, 'tokens': v} for n, v in models if n != '<synthetic>'][:4]})
print(json.dumps({'periods': out, 'since': first.date().isoformat() if first else None}))
