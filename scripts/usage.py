import json, glob, os, datetime as dt
now = dt.datetime.now(dt.timezone.utc)
seen = set(); first = None
periods = [('7 days', 7), ('30 days', 30), ('All time', None)]
fields = ('input', 'output', 'cacheWrite', 'cacheRead')
tot = {l: {'days': d, **{f: 0 for f in fields}, 'sessions': set(), 'models': {}} for l, d in periods}
for f in glob.glob(os.path.expanduser('~/.claude/projects/**/*.jsonl'), recursive=True):
    try:
        lines = open(f, errors='ignore')
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
        key = (m.get('id'), r.get('requestId'))
        if key in seen:
            continue
        seen.add(key)
        t = dt.datetime.fromisoformat(ts.replace('Z', '+00:00'))
        first = t if first is None or t < first else first
        vals = dict(zip(fields, (u.get('input_tokens') or 0, u.get('output_tokens') or 0,
                                 u.get('cache_creation_input_tokens') or 0, u.get('cache_read_input_tokens') or 0)))
        model = m.get('model') or 'unknown'
        age = (now - t).days
        for label, lim in periods:
            if lim is None or age < lim:
                p = tot[label]
                for k, v in vals.items():
                    p[k] += v
                p['sessions'].add(r.get('sessionId'))
                p['models'][model] = p['models'].get(model, 0) + sum(vals.values())
out = []
for label, p in tot.items():
    models = sorted(p['models'].items(), key=lambda kv: -kv[1])
    out.append({'label': label, 'days': p['days'], **{f: p[f] for f in fields},
                'tokens': sum(p[f] for f in fields), 'sessions': len(p['sessions']),
                'models': [{'name': n, 'tokens': v} for n, v in models if n != '<synthetic>'][:4]})
print(json.dumps({'periods': out, 'since': first.date().isoformat() if first else None}))
