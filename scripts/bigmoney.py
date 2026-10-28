"""Big money vs small lots + a 'possible distribution' flag (all ESTIMATES from the incremental side inference).

Big money = classified batches (one contract's volume added between two snapshots) with premium >= $250K;
small lots = everything else (see incremental.BIG_BATCH). Lean = big-money net / big-money total:
>= +10% bullish, <= -10% bearish, otherwise (or under $500K of big money) neutral.

Distribution flag: price rallying while large-premium flow leans bearish.
  price: up in >= 3 of the last 4 sessions (today's price vs the prior close counts as one), or >= +5% over those 4 sessions
  flow:  today's big-money lean is bearish; once >= 3 sessions of big-money history exist, the summed
         big-money net over the last up-to-4 sessions must be bearish too.
"""
import incremental as inc

LEAN_PCT, MIN_BIG, UP_PCT = 0.10, 500_000, 5.0

def lean(bull, bear):
    tot = (bull or 0) + (bear or 0)
    if tot < MIN_BIG: return "neutral"
    r = ((bull or 0) - (bear or 0)) / tot
    return "bullish" if r >= LEAN_PCT else "bearish" if r <= -LEAN_PCT else "neutral"

def price_up(closes, spot):
    if not spot or len(closes) < 4: return None
    seq = list(closes[-4:]) + [spot]
    ups = sum(1 for a, b in zip(seq, seq[1:]) if b > a)
    chg = (spot / seq[0] - 1) * 100 if seq[0] else 0
    return {"up_days": ups, "of": 4, "chg_pct": round(chg, 2), "rally": ups >= 3 or chg >= UP_PCT}

def annotate(tickers, scache, daily, today):
    days = (daily or {}).get("inferred", {}); today = today.isoformat()
    for t in tickers:
        fs = t.get("flow_sentiment")
        if t.get("status") != "ok" or not fs or "big_bull_premium" not in fs: continue
        bb, br = fs.get("big_bull_premium", 0), fs.get("big_bear_premium", 0)
        big = {"bull": bb, "bear": br, "small_bull": fs.get("bull_premium", 0) - bb, "small_bear": fs.get("bear_premium", 0) - br,
               "threshold": inc.BIG_BATCH, "since": fs.get("big_since"), "lean": lean(bb, br)}
        hist = [(d, r["t"][t["ticker"]]) for d, r in sorted(days.items()) if d < today and t["ticker"] in r.get("t", {})]
        hist = [(d, x["big_bull"] - x["big_bear"]) for d, x in hist if x.get("big_bull") is not None and x.get("big_bear") is not None][-3:]
        multi = None
        if len(hist) >= 2:   # today + >= 2 prior sessions with big-money data
            net = sum(n for _, n in hist) + bb - br
            multi = {"sessions": len(hist) + 1, "net": net, "bearish": net < 0}
        h = ((scache or {}).get("tickers", {}).get(t["ticker"]) or {}).get("hist") or {}
        pu = price_up(h.get("close") or [], t.get("spot"))
        flag = bool(pu and pu["rally"] and big["lean"] == "bearish" and (multi is None or multi["bearish"]))
        big["dist"] = {"flag": flag, "price": pu, "multi": multi}
        t["big_money"] = big
