#!/usr/bin/env python3
"""Pull delayed public options chains (yfinance) for the watchlist and write data/flow.json.
No data is fabricated: anything that fails is recorded as an error for that ticker."""
import json, math, datetime as dt, time, traceback
from zoneinfo import ZoneInfo
import yfinance as yf
import os
import volume_baseline as vb
import timeseries as ts
import daily
import incremental as inc

ET = ZoneInfo("America/New_York")
WATCHLIST = [
    ("TSLA", "Tesla"), ("NVDA", "NVIDIA"), ("PLTR", "Palantir"), ("MU", "Micron"),
    ("SKM", "SK Telecom"), ("TSM", "Taiwan Semiconductor"), ("INTC", "Intel"),
    ("MRVL", "Marvell"), ("BE", "Bloom Energy"), ("MSTR", "Strategy"), ("ASST", "Strive"),
    ("SPCX", "Space Exploration"), ("ECHO", "EchoStar"), ("TE", "T1 Energy"), ("VST", "Vistra"), ("LYFT", "Lyft"),
]
MAX_EXPIRIES = 8          # nearest N expirations per ticker
MAX_DTE = 120
RISK_FREE = 0.04
UNUSUAL_PREMIUM = 250_000  # $ threshold for "Large premium"
MIN_FLOW_PREMIUM = 25_000  # contracts below this premium are not shown on the tape
MAX_ROWS_PER_TICKER = 60

def num(x, d=0.0):
    try:
        x = float(x)
        return d if math.isnan(x) or math.isinf(x) else x
    except Exception:
        return d

def bs_gamma(S, K, T, iv):
    if S <= 0 or K <= 0 or T <= 0 or iv <= 0: return 0.0
    d1 = (math.log(S / K) + (RISK_FREE + 0.5 * iv * iv) * T) / (iv * math.sqrt(T))
    return math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi) / (S * iv * math.sqrt(T))

def max_pain(calls, puts):
    strikes = sorted({c["strike"] for c in calls} | {p["strike"] for p in puts})
    best, best_pain = None, None
    for s in strikes:
        pain = sum(max(0, s - c["strike"]) * c["oi"] for c in calls) + sum(max(0, p["strike"] - s) * p["oi"] for p in puts)
        if best_pain is None or pain < best_pain: best, best_pain = s, pain
    return best

def infer_side(c):
    """Infer aggressor side from last price vs bid/ask (chain snapshot, not a tape)."""
    bid, ask, last = c["bid"], c["ask"], c["last"]
    if bid > 0 and ask > 0 and ask >= bid:
        mid = (bid + ask) / 2
        if last >= ask - 0.25 * (ask - bid): return "ask"
        if last <= bid + 0.25 * (ask - bid): return "bid"
        return "mid" if abs(last - mid) <= 0.25 * (ask - bid) else ("ask" if last > mid else "bid")
    return "na"

def sentiment(cp, side):
    if side == "ask": return "bullish" if cp == "C" else "bearish"
    if side == "bid": return "bearish" if cp == "C" else "bullish"
    return "neutral"

SIDES_PATH = "data/sides.json"
try:
    SIDE_CACHE = json.load(open(SIDES_PATH))
except Exception:
    SIDE_CACHE = {}

def process(sym, expected):
    tk = yf.Ticker(sym)
    info = {}
    try: info = tk.info or {}
    except Exception: pass
    name = info.get("longName") or info.get("shortName") or ""
    name_ok = expected.lower().split()[0] in name.lower()
    spot = num(info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose"))
    if not spot:
        h = tk.history(period="5d")
        if len(h): spot = num(h["Close"].iloc[-1])
    out = {"ticker": sym, "expected": expected, "name": name, "name_ok": name_ok, "spot": round(spot, 2),
           "change_pct": round(num(info.get("regularMarketChangePercent")), 2), "status": "ok"}
    exps = list(tk.options or [])
    if not exps:
        out.update(status="no_options", message="No listed options data from source"); return out, []
    today = dt.datetime.now(ET).date()
    exps = [e for e in exps if (dt.date.fromisoformat(e) - today).days <= MAX_DTE][:MAX_EXPIRIES] or exps[:1]
    rows, all_contracts = [], []
    near = None
    last_trade = None
    for e in exps:
        try: ch = tk.option_chain(e)
        except Exception as ex:
            continue
        dte = (dt.date.fromisoformat(e) - today).days
        T = max(dte, 0.5) / 365.0
        calls, puts = [], []
        for cp, df in (("C", ch.calls), ("P", ch.puts)):
            for r in df.to_dict("records"):
                c = dict(cp=cp, expiry=e, dte=dte, strike=num(r.get("strike")), last=num(r.get("lastPrice")),
                         bid=num(r.get("bid")), ask=num(r.get("ask")), vol=int(num(r.get("volume"))),
                         oi=int(num(r.get("openInterest"))), iv=num(r.get("impliedVolatility")),
                         symbol=r.get("contractSymbol"), ts=r.get("lastTradeDate"))
                if c["ts"] is not None:
                    try:
                        c["ts"] = c["ts"].to_pydatetime().astimezone(ET).isoformat(); 
                        if last_trade is None or c["ts"] > last_trade: last_trade = c["ts"]
                    except Exception: c["ts"] = None
                (calls if cp == "C" else puts).append(c)
        if near is None and (calls or puts):
            near = {"expiry": e, "max_pain": max_pain(calls, puts)}
        for c in calls + puts:
            mid = (c["bid"] + c["ask"]) / 2 if c["bid"] > 0 and c["ask"] > 0 else 0
            px = c["last"] if c["last"] > 0 else mid
            c["premium"] = round(c["vol"] * px * 100)
            c["vol_oi"] = round(c["vol"] / c["oi"], 2) if c["oi"] > 0 else (None if c["vol"] == 0 else 999)
            iv = c["iv"] if c["iv"] > 0.01 else 0
            c["gex"] = bs_gamma(spot, c["strike"], T, iv) * c["oi"] * 100 * spot * spot * 0.01 * (1 if c["cp"] == "C" else -1)
            all_contracts.append(c)
    if not all_contracts:
        out.update(status="no_options", message="Option chains returned empty"); return out, []

    # Yahoo can carry a stale day-volume on contracts that did not trade in the latest session.
    # Treat volume as 0 unless the contract's last trade is on the latest session date for this ticker.
    session_date = last_trade[:10] if last_trade else None
    stale = 0
    for c in all_contracts:
        if c["vol"] > 0 and (not c["ts"] or c["ts"][:10] != session_date):
            c["vol"], c["premium"], stale = 0, 0, stale + 1
            c["vol_oi"] = None
    # Total session volume across ALL listed expirations (for the unusual-volume vs baseline check).
    extra_vol = 0
    for e in [x for x in (tk.options or []) if x not in exps]:
        try: ch = tk.option_chain(e)
        except Exception: continue
        for df in (ch.calls, ch.puts):
            for r in df[["volume", "lastTradeDate"]].to_dict("records"):
                v, ts = int(num(r.get("volume"))), r.get("lastTradeDate")
                try:
                    if v > 0 and ts is not None and ts.to_pydatetime().astimezone(ET).date().isoformat() == session_date: extra_vol += v
                except Exception: pass
    cvol = sum(c["vol"] for c in all_contracts if c["cp"] == "C"); pvol = sum(c["vol"] for c in all_contracts if c["cp"] == "P")
    coi = sum(c["oi"] for c in all_contracts if c["cp"] == "C"); poi = sum(c["oi"] for c in all_contracts if c["cp"] == "P")
    cprem = sum(c["premium"] for c in all_contracts if c["cp"] == "C"); pprem = sum(c["premium"] for c in all_contracts if c["cp"] == "P")
    # Incremental, locked-in side classification (scripts/incremental.py): per contract only the volume
    # added since the previous snapshot is classified, using THIS snapshot's in-session bid/ask/last, and
    # added to running per-session bullish/bearish/neutral totals persisted in data/sides.json.
    # Previously classified volume is never re-classified. Quotes are only trusted in-session (session date
    # is today and >= 9:30 ET); otherwise (pre-market, weekends) the saved totals are reused unchanged.
    now = dt.datetime.now(ET)
    live_ok = session_date == now.date().isoformat() and now.time() >= dt.time(9, 30)
    cached = SIDE_CACHE.get(sym, {})
    state, interval, adjust = None, None, None
    if live_ok:
        state, interval, adjust = inc.step(cached, session_date, all_contracts, now.isoformat(timespec="seconds"))
        SIDE_CACHE[sym] = state
        side_source = "live"
    elif cached.get("session_date") == session_date and cached.get("method") == "incremental":
        state, side_source = cached, "cached"
    else:
        side_source = "unavailable"
    SIDE_OF = {("bullish", "C"): "ask", ("bullish", "P"): "bid", ("bearish", "C"): "bid", ("bearish", "P"): "ask"}
    for c in all_contracts:
        sen = inc.contract_sentiment(state, c["symbol"]) if (state and c["vol"] > 0) else None
        c["sentiment"] = sen or "neutral"
        c["side"] = "na" if sen is None else SIDE_OF.get((sen, c["cp"]), "mid")
    # Running totals across ALL session-traded contracts seen this session (not just the displayed tape rows).
    tot = inc.totals(state) if state else {}
    fs = {k: tot.get(k, 0) for k in ("bull_orders", "bull_premium", "bear_orders", "bear_premium", "neutral_orders", "neutral_premium", "bull_vol", "bear_vol", "neutral_vol")}
    fs["method"] = "incremental"
    if state:
        fs.update(snapshots=state.get("n"), corrections=state.get("corr", 0), classified_through=state.get("ts"))
    if interval is not None:
        fs["interval"] = {"bull_premium": interval[0], "bear_premium": interval[1], "neutral_premium": interval[2]}
        fs["correction_adjust"] = {"bull_premium": adjust[0], "bear_premium": adjust[1], "neutral_premium": adjust[2]}
    flow = []
    for c in all_contracts:
        if c["vol"] <= 0: continue
        tags = []
        if c["oi"] > 0 and c["vol"] > c["oi"]: tags.append("Vol>OI")
        if c["vol_oi"] is not None and c["vol_oi"] >= 2 and c["vol"] >= 100: tags.append("Unusual")
        if c["oi"] == 0 and c["vol"] >= 100: tags.append("New OI")
        if c["premium"] >= UNUSUAL_PREMIUM: tags.append("Large premium")
        if c["premium"] < MIN_FLOW_PREMIUM and not tags: continue
        side = c["side"]
        otm = (c["strike"] > spot) if c["cp"] == "C" else (c["strike"] < spot)
        flow.append({"ticker": sym, "time": c["ts"], "expiry": c["expiry"], "dte": c["dte"], "strike": c["strike"], "cp": c["cp"],
                     "spot": round(spot, 2), "bid": c["bid"], "ask": c["ask"], "last": c["last"], "side": side,
                     "sentiment": c["sentiment"], "otm": otm, "vol": c["vol"], "oi": c["oi"], "vol_oi": c["vol_oi"],
                     "iv": round(c["iv"] * 100, 1), "premium": c["premium"], "tags": tags, "unusual": bool(tags), "symbol": c["symbol"]})
    flow.sort(key=lambda r: r["premium"], reverse=True)
    unusual_total = sum(1 for r in flow if r["unusual"])
    flow = flow[:MAX_ROWS_PER_TICKER]
    bull = sum(r["premium"] for r in flow if r["sentiment"] == "bullish"); bear = sum(r["premium"] for r in flow if r["sentiment"] == "bearish")
    by_strike = {}
    for c in all_contracts:
        k = (c["strike"], c["cp"]); by_strike[k] = by_strike.get(k, 0) + c["oi"]
    top_oi = sorted(({"strike": k[0], "cp": k[1], "oi": v} for k, v in by_strike.items()), key=lambda x: -x["oi"])[:5]
    gex_by_strike = {}
    for c in all_contracts: gex_by_strike[c["strike"]] = gex_by_strike.get(c["strike"], 0) + c["gex"]
    total_gex = sum(gex_by_strike.values())
    out.update({
        "expiries_scanned": len({c["expiry"] for c in all_contracts}), "contracts": len(all_contracts),
        "call_vol": cvol, "put_vol": pvol, "pc_vol": round(pvol / cvol, 2) if cvol else None,
        "call_oi": coi, "put_oi": poi, "pc_oi": round(poi / coi, 2) if coi else None,
        "call_premium": cprem, "put_premium": pprem,
        "bull_premium": bull, "bear_premium": bear, "flow_sentiment": fs, "side_source": side_source, "total_session_volume": cvol + pvol + extra_vol,
        "unusual_count": unusual_total,
        "nearest_expiry": near["expiry"] if near else None, "max_pain": near["max_pain"] if near else None,
        "top_oi": top_oi, "gex_total": round(total_gex), 
        "gex_top": [{"strike": k, "gex": round(v)} for k, v in sorted(gex_by_strike.items(), key=lambda kv: -abs(kv[1]))[:5]],
        "last_trade": last_trade, "session_date": session_date, "stale_volume_dropped": stale,
    })
    if not name_ok:
        out["message"] = f"Ticker resolved to '{name}', expected {expected}. Verify."
    return out, flow

def main():
    now = dt.datetime.now(ET)
    tickers, flow = [], []
    for sym, exp in WATCHLIST:
        for attempt in range(2):
            try:
                t, f = process(sym, exp); break
            except Exception as ex:
                t, f = {"ticker": sym, "expected": exp, "status": "error", "message": f"{type(ex).__name__}: {ex}"[:200]}, []
                time.sleep(2)
        tickers.append(t); flow.extend(f)
        print(sym, t.get("status"), t.get("name", ""), "rows", len(f))
    # Unusual options volume vs OCC 20-session average daily volume.
    hist = vb.load()
    try: hist = vb.update(hist, [s for s, _ in WATCHLIST], now.date())
    except Exception as ex: print("OCC history update failed:", ex)
    vb.save(hist)
    for t in tickers:
        if t.get("status") != "ok": continue
        sd = t.get("session_date"); base, n = vb.baseline(hist, t["ticker"], sd or now.date().isoformat())
        v = {"today": t["total_session_volume"], "session_date": sd, "baseline": round(base) if base else None, "baseline_days": n,
             "ratio": None, "pace_ratio": None, "session_fraction": None, "flag": None, "basis": None}
        if base and n >= vb.MIN_DAYS:
            v["ratio"] = round(t["total_session_volume"] / base, 2)
            frac = 1.0
            if sd == now.date().isoformat() and now.weekday() < 5:
                eff = now - dt.timedelta(minutes=15)   # quotes are ~15 min delayed
                mins = (eff.hour * 60 + eff.minute) - (9 * 60 + 30)
                frac = min(1.0, max(0.0, mins / 390))
            v["session_fraction"] = round(frac, 3)
            if frac >= 1.0:
                v["pace_ratio"], v["basis"], use = v["ratio"], "full session", v["ratio"]
            elif frac >= 30 / 390:
                v["pace_ratio"] = round(v["ratio"] / frac, 2); v["basis"], use = "pace", v["pace_ratio"]
            else:
                v["basis"], use = "raw (first 30 min, pace unreliable)", v["ratio"]
            v["flag"] = "extreme" if use >= 3 else ("high" if use >= 1.5 else None)
            v["flag_ratio"] = use
        t["vol_vs_avg"] = v
    def score(t):
        b, r = t["flow_sentiment"]["bull_premium"], t["flow_sentiment"]["bear_premium"]
        return (b - r) / (b + r) if (b + r) else 0
    ranked = [t for t in tickers if t.get("status") == "ok" and (t["flow_sentiment"]["bull_premium"] + t["flow_sentiment"]["bear_premium"]) > 0]
    for t in ranked: t["bias_score"] = round(score(t), 2)
    summary = {
        "bullish": [t["ticker"] for t in sorted(ranked, key=lambda t: -t["bias_score"]) if t["bias_score"] > 0.15][:5],
        "bearish": [t["ticker"] for t in sorted(ranked, key=lambda t: t["bias_score"]) if t["bias_score"] < -0.15][:5],
    }
    # Market status: snapshot taken outside 9:30-16:00 ET weekdays reflects the last session.
    open_ = now.weekday() < 5 and dt.time(9, 30) <= now.time() <= dt.time(16, 0)
    ok = [t for t in tickers if t.get("status") == "ok"]
    def board(k):
        rows = [{"ticker": t["ticker"], "orders": t["flow_sentiment"][k + "_orders"], "premium": t["flow_sentiment"][k + "_premium"]} for t in ok]
        return sorted([r for r in rows if r["premium"] > 0], key=lambda r: -r["premium"])
    sentiment_board = {"bullish": board("bull"), "bearish": board("bear"),
                       "bull_total": sum(t["flow_sentiment"]["bull_premium"] for t in ok), "bear_total": sum(t["flow_sentiment"]["bear_premium"] for t in ok),
                       "bull_orders": sum(t["flow_sentiment"]["bull_orders"] for t in ok), "bear_orders": sum(t["flow_sentiment"]["bear_orders"] for t in ok),
                       "neutral_total": sum(t["flow_sentiment"]["neutral_premium"] for t in ok),
                       "side_sources": {t["ticker"]: t["side_source"] for t in ok}}
    vol_meta = {"source": hist.get("source"), "days_in_history": len(hist["days"]), "latest_day": max(hist["days"]) if hist["days"] else None,
                "lookback": vb.LOOKBACK, "min_days": vb.MIN_DAYS, "thresholds": {"high": 1.5, "extreme": 3.0}}
    data = {"volume_meta": vol_meta, "sentiment_board": sentiment_board, "generated_at": now.isoformat(), "market_open_at_snapshot": open_, "source": "Yahoo Finance option chains via yfinance (delayed ~15 min)",
            "tickers": tickers, "flow": sorted(flow, key=lambda r: r["premium"], reverse=True), "summary": summary}
    keep = {sym for sym, _ in WATCHLIST}
    for k in [k for k in SIDE_CACHE if k not in keep]: del SIDE_CACHE[k]   # drop removed tickers
    with open(SIDES_PATH, "w") as fh: json.dump(SIDE_CACHE, fh, separators=(",", ":"))
    try:   # append this snapshot to today's intraday series and embed the latest session's series
        series = ts.append(data)
        if series is None:
            files = sorted(f for f in os.listdir(ts.DIR) if f.endswith(".json")) if os.path.isdir(ts.DIR) else []
            series = ts.load(files[-1][:-5]) if files else None
        data["timeseries"] = series
    except Exception as ex: print("timeseries failed:", ex)
    try:
        os.makedirs(ts.DIR, exist_ok=True)
        json.dump({"dates": sorted(f[:-5] for f in os.listdir(ts.DIR) if f.endswith(".json") and f != "index.json")},
                  open(f"{ts.DIR}/index.json", "w"))
    except Exception as ex: print("timeseries index failed:", ex)
    try:
        hist = vb.update_cp(hist, [s for s, _ in WATCHLIST], now.date(), sessions=28); vb.save(hist)
    except Exception as ex: print("OCC call/put update failed:", ex)
    try: data["daily"] = daily.payload(daily.update(data, now), hist, now.date())
    except Exception as ex: print("daily history failed:", ex)
    with open("data/flow.json", "w") as fh: json.dump(data, fh, separators=(",", ":"))
    print("wrote", len(flow), "rows")

if __name__ == "__main__":
    main()
