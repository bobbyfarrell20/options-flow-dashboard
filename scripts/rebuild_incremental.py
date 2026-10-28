#!/usr/bin/env python3
"""One-off: rebuild a session's incremental running totals by replaying the flow.json snapshots
committed to git that day. Limitation: committed snapshots only keep the displayed tape rows
(top 60 per ticker by premium, >= $25K or tagged), so contracts that never made the tape are not in
the replay; the next live run classifies their volume (as first-seen) at its own quotes.
Usage: python scripts/rebuild_incremental.py YYYY-MM-DD   (writes data/sides.json + data/timeseries/DAY.json)"""
import json, subprocess, sys, datetime as dt
sys.path.insert(0, "scripts")
import incremental as inc, timeseries as ts
from fetch_flow import WATCHLIST

day = sys.argv[1]
watch = [s for s, _ in WATCHLIST]
revs = subprocess.check_output(["git", "log", "--format=%H", "--", "data/flow.json"]).decode().split()
snaps = {}
for h in revs:
    try: d = json.loads(subprocess.check_output(["git", "show", f"{h}:data/flow.json"]))
    except Exception: continue
    g = d.get("generated_at", "")
    if g[:10] == day: snaps[g] = d
state, points = {}, []
for g in sorted(snaps):
    d = snaps[g]; gen = dt.datetime.fromisoformat(g)
    if gen.time() < dt.time(9, 30): continue
    pt = {}
    for t in d["tickers"]:
        s = t["ticker"]
        if s not in watch or t.get("status") != "ok" or t.get("session_date") != day: continue
        rows = [dict(symbol=r["symbol"], cp=r["cp"], vol=r["vol"], bid=r["bid"], ask=r["ask"], last=r["last"]) for r in d["flow"] if r["ticker"] == s]
        state[s], _, _ = inc.step(state.get(s), day, rows, g[:19])
        state[s]["rebuilt_from_git"] = True
        tot = inc.totals(state[s]); b, r = tot["bull_premium"], tot["bear_premium"]
        pt[s] = [b, r, b - r, t.get("total_session_volume")]
    if pt and gen.time() <= dt.time(16, 45): points.append({"ts": gen.isoformat(timespec="seconds"), "t": pt, "rebuilt": 1})
cur = json.load(open("data/sides.json"))
for s in watch:
    if s in state: cur[s] = state[s]
json.dump(cur, open("data/sides.json", "w"), separators=(",", ":"))
series = {"date": day, "points": points, "method": "incremental",
          "note": "Points before the first full live incremental run were rebuilt by replaying git-committed snapshots (tape rows only)."}
json.dump(series, open(f"{ts.DIR}/{day}.json", "w"), separators=(",", ":"))
print(len(snaps), "snapshots;", len(points), "points")
for s in watch:
    if s in state: print(s, inc.totals(state[s])["bull_premium"], inc.totals(state[s])["bear_premium"], state[s]["n"], state[s]["corr"])
