"""Intraday net-flow time series built from pipeline snapshots (Yahoo has no per-trade timestamps).
One file per session: data/timeseries/YYYY-MM-DD.json = {"date", "points": [{"ts", "t": {SYM: [bull, bear, net, vol]}}]}
Values are cumulative for the session as of each (delayed ~15 min) snapshot; side is inferred."""
import json, os, glob, datetime as dt

DIR = "data/timeseries"
KEEP = 10   # sessions

def point(data):
    """Build one point from a flow.json-style dict, or None if no live in-session sides."""
    t = {}
    gen = dt.datetime.fromisoformat(data["generated_at"])
    for x in data.get("tickers", []):
        fs = x.get("flow_sentiment")
        if x.get("status") != "ok" or not fs or x.get("side_source") != "live": continue
        if x.get("session_date") != gen.date().isoformat(): continue
        b, r = round(fs["bull_premium"]), round(fs["bear_premium"])
        vol = x.get("total_session_volume")
        if vol is None and x.get("call_vol") is not None: vol = (x.get("call_vol") or 0) + (x.get("put_vol") or 0)
        t[x["ticker"]] = [b, r, b - r, vol]
    # only regular-session snapshots (delayed data covers through ~16:15 ET)
    if not t or gen.weekday() >= 5 or not (dt.time(9, 30) <= gen.time() <= dt.time(16, 45)): return None
    return {"ts": gen.isoformat(timespec="seconds"), "t": t}

def load(day):
    try: return json.load(open(f"{DIR}/{day}.json"))
    except Exception: return {"date": day, "points": []}

def append(data):
    p = point(data)
    if not p: return None
    day = p["ts"][:10]; s = load(day)
    if not any(q["ts"] == p["ts"] for q in s["points"]):
        s["points"].append(p); s["points"].sort(key=lambda q: q["ts"])
    os.makedirs(DIR, exist_ok=True)
    json.dump(s, open(f"{DIR}/{day}.json", "w"), separators=(",", ":"))
    for f in sorted(glob.glob(f"{DIR}/2*.json"))[:-KEEP]: os.remove(f)
    return s
