"""Incremental (locked-in) side classification.

Yahoo chains only expose each contract's CUMULATIVE session volume plus the current bid/ask/last.
Re-inferring the side of the whole session's volume on every snapshot lets earlier trades flip
sides as quotes move. Instead, per contract we remember the cumulative volume seen at the previous
snapshot and classify ONLY the new volume (delta) with this snapshot's bid/ask/last. Classified
volume/premium is added to persisted per-contract buckets and never re-classified.

State per ticker (data/sides.json[SYM]):
  {"session_date", "method": "incremental", "n": snapshots applied, "ts": last snapshot time,
   "corr": volume-decrease corrections, "c": {contract: [last_cum_vol, bull_v, bear_v, neu_v, bull_$, bear_$, neu_$]}}
Rules
  * new session_date -> state resets (running totals restart each session)
  * first time a contract is seen in a session -> its whole cumulative volume is the delta
    (on the day's first snapshot that means "since the open", classified at that snapshot's quote)
  * contract missing from a snapshot (chain fetch failed / not reported) -> its buckets are kept
    as-is (locked); when it reappears only the volume above its last seen cumulative is classified
  * reported volume 0 / stale for a contract we already classified -> treated as missing (kept)
  * cumulative volume DEcreases to a positive value (data correction) -> that contract's buckets are scaled down
    proportionally to the new cumulative volume; nothing is re-classified
"""
SENT = ("bull", "bear", "neu")

def infer_side(bid, ask, last):
    if bid > 0 and ask > 0 and ask >= bid:
        mid = (bid + ask) / 2
        if last >= ask - 0.25 * (ask - bid): return "ask"
        if last <= bid + 0.25 * (ask - bid): return "bid"
        return "mid" if abs(last - mid) <= 0.25 * (ask - bid) else ("ask" if last > mid else "bid")
    return "na"

def bucket(cp, side):
    if side == "ask": return 0 if cp == "C" else 1
    if side == "bid": return 1 if cp == "C" else 0
    return 2

def price(bid, ask, last):
    if last > 0: return last
    return (bid + ask) / 2 if bid > 0 and ask > 0 else 0.0

def new_state(session_date):
    return {"session_date": session_date, "method": "incremental", "n": 0, "ts": None, "corr": 0, "c": {}}

def step(state, session_date, contracts, ts=None):
    """Apply one snapshot. contracts: iterable of dicts with symbol, cp, vol, bid, ask, last
    (vol already zeroed for contracts that did not trade in session_date).
    Returns (state, interval, adjust): interval = [bull_$, bear_$, neu_$] newly classified in this step,
    adjust = premium removed from locked buckets by volume-decrease corrections (normally 0).
    Invariant: new running total = previous running total + interval - adjust."""
    if not state or state.get("session_date") != session_date or state.get("method") != "incremental":
        state = new_state(session_date)
    C = state["c"]; iv = [0, 0, 0]; adj = [0, 0, 0]
    for k in contracts:
        sym, vol = k["symbol"], int(k["vol"] or 0)
        if not sym: continue
        b = C.get(sym)
        if b is None:
            if vol <= 0: continue
            b = C[sym] = [0, 0, 0, 0, 0, 0, 0]
        prev = b[0]
        if vol > prev:
            d = vol - prev
            i = bucket(k["cp"], infer_side(k["bid"], k["ask"], k["last"]))
            p = d * price(k["bid"], k["ask"], k["last"]) * 100
            b[1 + i] += d; b[4 + i] += round(p); iv[i] += round(p)
            b[0] = vol
        elif 0 < vol < prev:
            # correction: shrink locked buckets to the corrected cumulative volume (no re-classification)
            f = vol / prev if prev > 0 else 0
            for j in range(1, 7):
                nv = int(round(b[j] * f))
                if j >= 4: adj[j - 4] += b[j] - nv
                b[j] = nv
            b[0] = vol; state["corr"] += 1
        # vol == 0 while prev > 0: treated as missing/unreported this snapshot -> buckets stay locked
    state["n"] += 1; state["ts"] = ts
    return state, iv, adj

def totals(state):
    t = {"bull_premium": 0, "bear_premium": 0, "neutral_premium": 0, "bull_orders": 0, "bear_orders": 0, "neutral_orders": 0,
         "bull_vol": 0, "bear_vol": 0, "neutral_vol": 0}
    names = ("bull", "bear", "neutral")
    for b in (state or {}).get("c", {}).values():
        for i, n in enumerate(names):
            t[n + "_premium"] += b[4 + i]; t[n + "_vol"] += b[1 + i]
        if b[0] > 0: t[names[dominant(b)] + "_orders"] += 1
    return t

def dominant(b):
    """Index (0 bull, 1 bear, 2 neutral) holding the most locked premium (volume as tiebreak)."""
    return max(range(3), key=lambda i: (b[4 + i], b[1 + i]))

def contract_sentiment(state, sym):
    b = (state or {}).get("c", {}).get(sym)
    if not b or b[0] <= 0: return None
    return ("bullish", "bearish", "neutral")[dominant(b)]
