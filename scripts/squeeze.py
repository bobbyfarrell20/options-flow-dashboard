"""Squeeze meter: a RISK GAUGE for short-squeeze conditions, NOT a squeeze confirmation.

Nothing here can confirm a squeeze in real time: short interest is reported twice a month (FINRA settlement
dates, published ~1-2 weeks later) and Yahoo's short % of float lags the same way. Missing inputs are left
missing (never estimated) and their weight is dropped; the score is withheld if short % of float is unknown.

Sources (all free, no key):
  * Yahoo Finance via yfinance `info`: shortPercentOfFloat, shortRatio, sharesShort, sharesShortPriorMonth,
    dateShortInterest, sharesShortPreviousMonthDate.                                   (cached once per ET day)
  * FINRA consolidated short interest API (api.finra.org, biweekly): current/previous position, change %,
    days to cover, settlement date.                                                   (cached once per ET day)
  * Yahoo daily price history (yfinance, prior 25 sessions): closes, highs, volume.  (cached once per ET day)
  * Intraday (each run): delayed spot / day change / stock volume and the option-chain signals already
    computed by fetch_flow.py (options volume pace ratio, net inferred premium, call share vs 20d avg,
    short-dated OTM call volume, estimated GEX sign).
  * Borrow fee / availability: no free keyless source reachable (iborrowdesk.com refused connections), so it
    is not used.

Score
  SETUP  (0-100, short-interest setup), weights:
     short % of float      0.55   0 at <=5%,  100 at >=30%
     days to cover         0.25   0 at <=1,   100 at >=8      (FINRA, else Yahoo shortRatio)
     SI change vs prior    0.20   0 at <=0%,  100 at >=+30%   (FINRA biweekly, else Yahoo vs prior month)
  TRIGGER (0-100, momentum + flow), weights:
     day % change          0.20   0 at <=0%,  100 at >=+8%
     5-day % change        0.15   0 at <=0%,  100 at >=+20%
     price vs 20d high     0.10   0 at <=-10% below, 100 at/above the prior 20-session high
     stock rel. volume     0.15   0 at <=1x,  100 at >=3x 20d avg (pace-adjusted intraday)
     options vol pace      0.10   0 at <=1x,  100 at >=3x OCC 20d avg
     net inferred premium  0.10   0 at <=0,   100 at >=+0.5  ((bull-bear)/(bull+bear))
     call share vs 20d     0.05   0 at <=0pp, 100 at >=+15pp
     short-dated OTM calls 0.10   0 at <=20%, 100 at >=60% of call volume (<=7 DTE, strike > spot)
     est. GEX sign         0.05   100 if negative (dealers short gamma), else 0
  SCORE = sqrt(SETUP * TRIGGER) (geometric mean: both must be high), and capped at 39 when SETUP < 40 or
  TRIGGER < 25, capped at 59 when SETUP < 60 or TRIGGER < 40. Levels: <40 hidden, 40-59 watch, 60+ conditions.
"""
import json, math, datetime as dt
import requests, yfinance as yf

PATH = "data/short.json"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)", "Accept": "application/json", "Content-Type": "application/json"}
SETUP_W = {"si_float": .55, "dtc": .25, "si_change": .20}
TRIG_W = {"day": .20, "d5": .15, "vs_high": .10, "rel_vol": .15, "opt_pace": .10, "net_prem": .10, "cs_skew": .05, "otm_short": .10, "gex": .05}

def lin(x, lo, hi):
    if x is None: return None
    return max(0.0, min(100.0, (x - lo) / (hi - lo) * 100))

def _d(ts):
    try: return dt.datetime.utcfromtimestamp(int(ts)).date().isoformat()
    except Exception: return None

def finra(sym, today):
    body = {"limit": 10, "compareFilters": [{"compareType": "EQUAL", "fieldName": "symbolCode", "fieldValue": sym}],
            "dateRangeFilters": [{"fieldName": "settlementDate", "startDate": (today - dt.timedelta(days=75)).isoformat(), "endDate": today.isoformat()}]}
    r = requests.post("https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest", json=body, headers=UA, timeout=20)
    r.raise_for_status(); rows = sorted(r.json() or [], key=lambda x: x["settlementDate"])
    if not rows: return None
    x = rows[-1]
    return {"settlement": x["settlementDate"], "short": x.get("currentShortPositionQuantity"), "prev": x.get("previousShortPositionQuantity"),
            "change_pct": x.get("changePercent"), "dtc": x.get("daysToCoverQuantity"), "adv": x.get("averageDailyVolumeQuantity")}

def update(symbols, now, force=False):
    try: c = json.load(open(PATH))
    except Exception: c = {}
    today = now.date()
    if c.get("fetched") == today.isoformat() and not force and all(s in c.get("tickers", {}) for s in symbols): return c
    out = {}
    for s in symbols:
        e = {"yahoo": None, "finra": None, "hist": None, "errors": []}
        tk = yf.Ticker(s)
        try:
            i = tk.info or {}
            e["yahoo"] = {"pct_float": i.get("shortPercentOfFloat"), "short_ratio": i.get("shortRatio"), "shares_short": i.get("sharesShort"),
                          "prior_month": i.get("sharesShortPriorMonth"), "date": _d(i.get("dateShortInterest")), "prior_date": _d(i.get("sharesShortPreviousMonthDate"))}
        except Exception as ex: e["errors"].append(f"yahoo info: {type(ex).__name__}")
        try: e["finra"] = finra(s, today)
        except Exception as ex: e["errors"].append(f"finra: {type(ex).__name__}")
        try:
            h = tk.history(period="3mo", interval="1d", auto_adjust=False)
            h = h[[d.date() < today for d in h.index]].tail(25)   # completed sessions only
            if len(h) >= 6:
                e["hist"] = {"dates": [d.date().isoformat() for d in h.index], "close": [round(float(v), 4) for v in h["Close"]],
                             "high": [round(float(v), 4) for v in h["High"]], "vol": [int(v) for v in h["Volume"]]}
        except Exception as ex: e["errors"].append(f"history: {type(ex).__name__}")
        out[s] = e
    c = {"fetched": today.isoformat(), "fetched_at": now.isoformat(timespec="seconds"), "tickers": out}
    json.dump(c, open(PATH, "w"), separators=(",", ":"))
    return c

def compute(t, sc, daily, frac, today):
    """t = ticker row from fetch_flow; sc = short cache entry; daily = data['daily'] payload; frac = session fraction."""
    y, f, h = sc.get("yahoo") or {}, sc.get("finra") or {}, sc.get("hist") or {}
    F = {}   # factor -> {value, unit, date, source, sub}
    def put(k, v, sub, date, src, **kw): F[k] = dict(value=v, sub=None if sub is None else round(sub), date=date, source=src, **kw)
    pf = y.get("pct_float")
    put("si_float", None if pf is None else round(pf * 100, 2), lin(None if pf is None else pf * 100, 5, 30), y.get("date"), "Yahoo (exchange-reported SI / float)")
    if f.get("dtc") is not None: put("dtc", f["dtc"], lin(f["dtc"], 1, 8), f.get("settlement"), "FINRA (biweekly)")
    else: put("dtc", y.get("short_ratio"), lin(y.get("short_ratio"), 1, 8), y.get("date"), "Yahoo shortRatio")
    if f.get("change_pct") is not None:
        put("si_change", f["change_pct"], lin(f["change_pct"], 0, 30), f.get("settlement"), "FINRA vs previous biweekly report")
    elif y.get("shares_short") and y.get("prior_month"):
        ch = round((y["shares_short"] / y["prior_month"] - 1) * 100, 2)
        put("si_change", ch, lin(ch, 0, 30), y.get("date"), f"Yahoo vs prior month ({y.get('prior_date')})")
    else: put("si_change", None, None, None, "n/a")
    sd = t.get("session_date"); spot = t.get("spot")
    put("day", t.get("change_pct"), lin(t.get("change_pct"), 0, 8), sd, "Yahoo (delayed)")
    cl, hi, vo = h.get("close") or [], h.get("high") or [], h.get("vol") or []
    d5 = round((spot / cl[-5] - 1) * 100, 2) if spot and len(cl) >= 5 and cl[-5] else None   # vs close 5 sessions ago
    put("d5", d5, lin(d5, 0, 20), sd, f"Yahoo daily (vs close {h['dates'][-5]})" if d5 is not None else "n/a")
    h20 = max(hi[-20:]) if len(hi) >= 10 else None
    vh = round((spot / h20 - 1) * 100, 2) if spot and h20 else None
    put("vs_high", vh, lin(vh, -10, 0), sd, "Yahoo daily (prior 20-session high)" if vh is not None else "n/a", ref=h20)
    sv, a20 = t.get("stock_volume"), (sum(vo[-20:]) / len(vo[-20:]) if len(vo) >= 10 else None)
    rv = None
    if sv and a20:
        rv = sv / a20 / (frac if 30 / 390 <= frac < 1 else 1)
        rv = round(rv, 2)
    put("rel_vol", rv, lin(rv, 1, 3), sd, "Yahoo volume vs 20d avg" + (" (linear pace-adjusted; intraday volume is U-shaped, so early-session pace runs high)" if 30 / 390 <= frac < 1 else ""), avg20=None if a20 is None else round(a20))
    v = t.get("vol_vs_avg") or {}; op = v.get("flag_ratio")
    put("opt_pace", op, lin(op, 1, 3), sd, f"OCC 20d avg ({v.get('basis')})" if op is not None else "n/a")
    fs = t.get("flow_sentiment") or {}; b, r = fs.get("bull_premium", 0), fs.get("bear_premium", 0)
    np_ = round((b - r) / (b + r), 3) if b + r else None
    put("net_prem", np_, lin(np_, 0, .5), sd, "inferred side, delayed quotes")
    cv, pv = t.get("call_vol") or 0, t.get("put_vol") or 0
    base = (((daily or {}).get("cs_base") or {}).get(sd) or {}).get(t["ticker"])
    sk = round((cv / (cv + pv) - base["share"]) * 100, 1) if base and cv + pv else None
    put("cs_skew", sk, lin(sk, 0, 15), sd, "call share vs OCC 20d avg" if sk is not None else "n/a")
    otm = t.get("otm_short_call_share")
    put("otm_short", None if otm is None else round(otm * 100, 1), lin(None if otm is None else otm * 100, 20, 60), sd, "calls <=7 DTE, strike > spot, share of call volume")
    g = t.get("gex_total")
    put("gex", g, None if g is None else (100.0 if g < 0 else 0.0), sd, "estimated from OI (dealer sign assumed)")
    def agg(W):
        got = [(W[k], F[k]["sub"]) for k in W if F[k]["sub"] is not None]
        wsum = sum(w for w, _ in got)
        return (round(sum(w * s for w, s in got) / wsum), round(wsum, 2)) if wsum else (None, 0)
    setup, sw = agg(SETUP_W); trig, tw = agg(TRIG_W)
    score, level = None, None
    if setup is not None and F["si_float"]["sub"] is not None and trig is not None:
        score = math.sqrt(setup * trig)
        if setup < 40 or trig < 25: score = min(score, 39)
        elif setup < 60 or trig < 40: score = min(score, 59)
        score = round(score)
        level = "conditions" if score >= 60 else ("watch" if score >= 40 else None)
    return {"score": score, "level": level, "setup": setup, "trigger": trig, "setup_weight_used": sw, "trigger_weight_used": tw,
            "factors": F, "si_date": f.get("settlement") or y.get("date"), "errors": sc.get("errors") or []}
