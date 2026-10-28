"""Daily options-volume history per ticker from the OCC public volume query (no key).
OCC reports each cleared contract once per side, so total contracts = sum(quantity) / 2."""
import csv, io, json, time, datetime as dt, urllib.request

HIST_PATH = "data/volume_history.json"
OCC_URL = ("https://marketdata.theocc.com/volume-query?reportDate={d}&format=csv&volumeQueryType=O&symbolType=U"
           "&symbol={s}&reportType=D&accountType=ALL&productKind=ALL&porc=BOTH")
LOOKBACK = 20
MIN_DAYS = 5   # no baseline / no badge until at least this many sessions exist

def occ_volume(sym, day):
    url = OCC_URL.format(d=day.strftime("%Y%m%d"), s=sym)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 farrell-flow"})
    txt = urllib.request.urlopen(req, timeout=20).read().decode()
    rows = list(csv.DictReader(io.StringIO(txt)))
    rows = [r for r in rows if (r.get("underlying") or "").upper() == sym]
    if not rows: return None
    return int(sum(int(r["quantity"]) for r in rows) / 2)

def load():
    try: return json.load(open(HIST_PATH))
    except Exception: return {"source": "OCC daily volume query (theocc.com)", "days": {}, "checked": {}}

def save(h):
    json.dump(h, open(HIST_PATH, "w"), separators=(",", ":"), sort_keys=True)

def update(h, tickers, today, max_new_days=25, budget_s=150):
    """Fill missing completed sessions (strictly before `today`) for the last ~30 weekdays."""
    t0 = time.time()
    days, d = [], today - dt.timedelta(days=1)
    while len(days) < LOOKBACK + 8:
        if d.weekday() < 5: days.append(d)
        d -= dt.timedelta(days=1)
    fetched = 0
    for day in days:
        key = day.isoformat()
        if h["checked"].get(key) == "empty": continue
        have = h["days"].get(key, {})
        missing = [s for s in tickers if s not in have]
        if not missing: continue
        if fetched >= max_new_days or time.time() - t0 > budget_s: break
        vols = dict(have)
        for s in missing:
            for attempt in range(3):   # OCC sometimes returns transient HTTP errors
                try:
                    v = occ_volume(s, day)
                    if v is not None: vols[s] = v
                    break
                except Exception as ex:
                    if attempt == 2: print("OCC fail", s, key, type(ex).__name__)
                    else: time.sleep(1.5 * (attempt + 1))
        fetched += 1
        if vols: h["days"][key] = vols
        elif (today - day).days > 3: h["checked"][key] = "empty"   # holiday / no data; recheck recent days later
    # drop tickers no longer on the watchlist
    for k in list(h["days"]):
        h["days"][k] = {s: v for s, v in h["days"][k].items() if s in tickers}
    # keep only the most recent 40 sessions
    for k in sorted(h["days"])[:-40]: del h["days"][k]
    return h

def baseline(h, sym, before):
    vals = [v[sym] for k, v in sorted(h["days"].items()) if k < before and sym in v][-LOOKBACK:]
    return (sum(vals) / len(vals), len(vals)) if vals else (None, 0)
