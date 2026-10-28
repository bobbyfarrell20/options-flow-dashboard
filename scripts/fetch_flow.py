#!/usr/bin/env python3
"""Pull delayed public options chains (yfinance) for the watchlist and write data/flow.json.
No data is fabricated: anything that fails is recorded as an error for that ticker."""
import json, math, datetime as dt, time, traceback
from zoneinfo import ZoneInfo
import yfinance as yf

ET = ZoneInfo("America/New_York")
WATCHLIST = [
    ("TSLA", "Tesla"), ("NVDA", "NVIDIA"), ("PLTR", "Palantir"), ("MU", "Micron"),
    ("SKM", "SK Telecom"), ("TSM", "Taiwan Semiconductor"), ("INTC", "Intel"),
    ("MRVL", "Marvell"), ("BE", "Bloom Energy"), ("MSTR", "Strategy"), ("ASST", "Strive"),
    ("SPCX", "Space Exploration"), ("ECHO", "EchoStar"), ("TE", "T1 Energy"), ("VRT", "Vertiv"),
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
    cvol = sum(c["vol"] for c in all_contracts if c["cp"] == "C"); pvol = sum(c["vol"] for c in all_contracts if c["cp"] == "P")
    coi = sum(c["oi"] for c in all_contracts if c["cp"] == "C"); poi = sum(c["oi"] for c in all_contracts if c["cp"] == "P")
    cprem = sum(c["premium"] for c in all_contracts if c["cp"] == "C"); pprem = sum(c["premium"] for c in all_contracts if c["cp"] == "P")
    flow = []
    for c in all_contracts:
        if c["vol"] <= 0: continue
        tags = []
        if c["oi"] > 0 and c["vol"] > c["oi"]: tags.append("Vol>OI")
        if c["vol_oi"] is not None and c["vol_oi"] >= 2 and c["vol"] >= 100: tags.append("Unusual")
        if c["oi"] == 0 and c["vol"] >= 100: tags.append("New OI")
        if c["premium"] >= UNUSUAL_PREMIUM: tags.append("Large premium")
        if c["premium"] < MIN_FLOW_PREMIUM and not tags: continue
        side = infer_side(c)
        otm = (c["strike"] > spot) if c["cp"] == "C" else (c["strike"] < spot)
        flow.append({"ticker": sym, "time": c["ts"], "expiry": c["expiry"], "dte": c["dte"], "strike": c["strike"], "cp": c["cp"],
                     "spot": round(spot, 2), "bid": c["bid"], "ask": c["ask"], "last": c["last"], "side": side,
                     "sentiment": sentiment(c["cp"], side), "otm": otm, "vol": c["vol"], "oi": c["oi"], "vol_oi": c["vol_oi"],
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
        "bull_premium": bull, "bear_premium": bear,
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
    def score(t):
        b, r = t.get("bull_premium", 0), t.get("bear_premium", 0)
        return (b - r) / (b + r) if (b + r) else 0
    ranked = [t for t in tickers if t.get("status") == "ok" and (t.get("bull_premium", 0) + t.get("bear_premium", 0)) > 0]
    for t in ranked: t["bias_score"] = round(score(t), 2)
    summary = {
        "bullish": [t["ticker"] for t in sorted(ranked, key=lambda t: -t["bias_score"]) if t["bias_score"] > 0.15][:5],
        "bearish": [t["ticker"] for t in sorted(ranked, key=lambda t: t["bias_score"]) if t["bias_score"] < -0.15][:5],
    }
    # Market status: snapshot taken outside 9:30-16:00 ET weekdays reflects the last session.
    open_ = now.weekday() < 5 and dt.time(9, 30) <= now.time() <= dt.time(16, 0)
    data = {"generated_at": now.isoformat(), "market_open_at_snapshot": open_, "source": "Yahoo Finance option chains via yfinance (delayed ~15 min)",
            "tickers": tickers, "flow": sorted(flow, key=lambda r: r["premium"], reverse=True), "summary": summary}
    with open("data/flow.json", "w") as fh: json.dump(data, fh, separators=(",", ":"))
    print("wrote", len(flow), "rows")

if __name__ == "__main__":
    main()
