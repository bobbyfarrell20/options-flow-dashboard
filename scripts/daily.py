"""End-of-session daily summary per ticker (data/daily_history.json) + the 2-week view payload.
Inferred bull/bear premium exists only for sessions the pipeline captured live (from 2026-10-28).
Older sessions get OCC call/put contract volume only (no side, no premium) - never mixed or estimated."""
import json, datetime as dt

PATH = "data/daily_history.json"
KEEP = 30

def load():
    try: return json.load(open(PATH))
    except Exception: return {"days": {}}

def update(data, now):
    """Upsert today's row from the latest in-session snapshot; the post-close run leaves the final values."""
    h = load(); today = now.date().isoformat(); row = {}
    for t in data.get("tickers", []):
        fs = t.get("flow_sentiment")
        if t.get("status") != "ok" or not fs or t.get("side_source") != "live" or t.get("session_date") != today: continue
        v = t.get("vol_vs_avg") or {}
        cv, pv = t.get("call_vol"), t.get("put_vol")
        row[t["ticker"]] = {"bull": round(fs["bull_premium"]), "bear": round(fs["bear_premium"]),
                            "net": round(fs["bull_premium"] - fs["bear_premium"]),
                            "call_vol": cv, "put_vol": pv, "pc": t.get("pc_vol"),
                            "vol": v.get("today"), "avg20": v.get("baseline"), "vol_ratio": v.get("ratio")}
    if row and now.weekday() < 5 and now.time() >= dt.time(9, 30):
        h["days"][today] = {"as_of": now.isoformat(timespec="minutes"), "final": now.time() >= dt.time(16, 15), "t": row}
    for k in sorted(h["days"])[:-KEEP]: del h["days"][k]
    json.dump(h, open(PATH, "w"), separators=(",", ":"), sort_keys=True)
    return h

def cs_base(cp, day, n=20, min_days=10):
    """Volume-weighted call share (calls / (calls+puts)) over the n OCC sessions before `day`, per ticker."""
    prior = sorted(k for k in cp if k < day)[-n:]; out = {}
    for s in {s for k in prior for s in cp[k]}:
        rows = [cp[k][s] for k in prior if s in cp[k] and sum(cp[k][s]) > 0]
        tot = sum(c + p for c, p in rows)
        if len(rows) >= min_days and tot: out[s] = {"share": round(sum(c for c, _ in rows) / tot, 4), "days": len(rows)}
    return out

def payload(h, vol_hist, today, sessions=5):
    """The `sessions` prior completed sessions, plus today (live) once today's in-session data exists."""
    cp = vol_hist.get("cp", {}); today = today.isoformat()
    dates = sorted(d for d in set(cp) | set(h["days"]) if d < today)[-sessions:]
    if today in h["days"]: dates.append(today)
    return {"dates": dates, "today": today if today in h["days"] else None,
            "inferred": {d: h["days"][d] for d in dates if d in h["days"]},
            "occ_cp": {d: cp[d] for d in dates if d in cp},
            "cs_base": {d: cs_base(cp, d) for d in dates},
            "notes": {"inferred": "Inferred net premium from live delayed snapshots (incremental, locked-in classification of each snapshot's new volume vs that snapshot's bid/ask); available from 2026-10-28.",
                      "occ_cp": "OCC cleared contract volume, calls vs puts, completed sessions only. No side, no premium."}}
