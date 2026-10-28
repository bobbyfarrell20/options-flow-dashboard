"""Next earnings date per ticker, refreshed once per ET day and cached in data/earnings.json.
Sources (free, keyless): Yahoo Finance via yfinance (date + confirmed/estimated flag + call time) and the
Nasdaq earnings calendar API (cross-check + BMO/AMC timing). Nothing is invented: unknown -> null."""
import json, datetime as dt, time, urllib.request
from zoneinfo import ZoneInfo
import yfinance as yf

ET = ZoneInfo("America/New_York")
PATH = "data/earnings.json"
NASDAQ = "https://api.nasdaq.com/api/calendar/earnings?date={}"
NQ_TIME = {"time-pre-market": "BMO", "time-after-hours": "AMC"}

def _d(ts):
    return dt.datetime.fromtimestamp(ts, ET) if ts else None

def yahoo(sym, today):
    i = yf.Ticker(sym).info or {}
    start = _d(i.get("earningsTimestampStart") or i.get("earningsTimestamp"))
    est = i.get("isEarningsDateEstimate")
    out = {"next": None, "last": None}
    if start:
        call = _d(i.get("earningsCallTimestampStart"))
        timing = None
        if call and call.date() == start.date():
            timing = "BMO" if call.time() < dt.time(9, 30) else ("AMC" if call.time() >= dt.time(16, 0) else None)
        rec = {"date": start.date().isoformat(), "timing": timing, "estimated": bool(est) if est is not None else None}
        out["next" if start.date() >= today else "last"] = rec
    return out

def nasdaq(days):
    """{symbol: {"date", "timing"}} for the given dates (calendar lists both confirmed and projected reports)."""
    found, ok = {}, 0
    for d in days:
        try:
            req = urllib.request.Request(NASDAQ.format(d), headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
            rows = (json.load(urllib.request.urlopen(req, timeout=15)).get("data") or {}).get("rows") or []
            ok += 1
            for r in rows:
                found.setdefault(r.get("symbol"), {"date": d, "timing": NQ_TIME.get(r.get("time"))})
        except Exception as ex:
            print("nasdaq earnings", d, type(ex).__name__)
        time.sleep(0.3)
    return found, ok

def load():
    try: return json.load(open(PATH))
    except Exception: return {"fetched": None, "tickers": {}}

def update(symbols, now=None, force=False):
    now = now or dt.datetime.now(ET); today = now.date()
    cache = load()
    if cache.get("fetched") == today.isoformat() and not force and set(symbols) <= set(cache["tickers"]):
        return cache
    days = [(today + dt.timedelta(days=k)).isoformat() for k in range(-1, 8)]
    nq, nq_ok = nasdaq(days)
    out = {}
    for s in symbols:
        prev = cache.get("tickers", {}).get(s, {})
        try: y = yahoo(s, today)
        except Exception as ex: y = {"next": None, "last": None}; print("yahoo earnings", s, type(ex).__name__)
        n = nq.get(s)
        rec = {"next": None, "last": None, "sources": [], "conflict": None}
        yn = y["next"]
        if yn:
            rec["next"] = dict(yn, source="Yahoo"); rec["sources"].append("Yahoo")
        if n and n["date"] >= today.isoformat():
            if rec["next"] and rec["next"]["date"] == n["date"]:
                rec["sources"].append("Nasdaq")
                if n["timing"]: rec["next"]["timing"] = n["timing"]; rec["next"]["timing_source"] = "Nasdaq"
            elif rec["next"]:
                rec["conflict"] = f"Nasdaq calendar lists {n['date']}"
                if rec["next"].get("estimated"):   # Yahoo only estimated -> prefer the listed Nasdaq date
                    rec["next"] = {"date": n["date"], "timing": n["timing"], "estimated": None, "source": "Nasdaq"}
                    rec["conflict"] = f"Yahoo estimate was {yn['date']}"; rec["sources"] = ["Nasdaq"]
            else:
                rec["next"] = {"date": n["date"], "timing": n["timing"], "estimated": None, "source": "Nasdaq"}; rec["sources"].append("Nasdaq")
        if rec["next"] and rec["next"].get("timing") and "timing_source" not in rec["next"]:
            rec["next"]["timing_source"] = rec["next"]["source"] + (" (call time)" if rec["next"]["source"] == "Yahoo" else "")
        # last report: Yahoo's past date, Nasdaq yesterday listing, or yesterday's cached "next" that has now passed
        last = y["last"]
        if n and n["date"] < today.isoformat(): last = last or {"date": n["date"], "timing": n["timing"], "estimated": None}
        pn = prev.get("next")
        if pn and pn["date"] < today.isoformat() and (not last or pn["date"] > last["date"]) and not pn.get("estimated"): last = pn
        rec["last"] = last
        out[s] = rec
    cache = {"fetched": today.isoformat(), "fetched_at": now.isoformat(timespec="seconds"), "nasdaq_days_ok": nq_ok,
             "sources": {"Yahoo": "Yahoo Finance quote data via yfinance (earningsTimestampStart, isEarningsDateEstimate, call time)",
                         "Nasdaq": "api.nasdaq.com earnings calendar (date + pre-market/after-hours)"},
             "tickers": out}
    json.dump(cache, open(PATH, "w"), indent=1)
    return cache

if __name__ == "__main__":
    import sys; sys.path.insert(0, "scripts")
    from fetch_flow import WATCHLIST
    c = update([s for s, _ in WATCHLIST], force=True)
    for s, r in c["tickers"].items(): print(s, r)
