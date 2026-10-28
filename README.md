# Farrell Flow

A dark, dense options-flow style dashboard for a fixed 15-ticker watchlist:
TSLA, NVDA, PLTR, MU, SKM, TSM, INTC, MRVL, BE, MSTR, ASST, SPCX, ECHO, TE, VST, LYFT.

Live site: https://bobbyfarrell20.github.io/options-flow-dashboard/

## How it works
- `scripts/fetch_flow.py` pulls **delayed public option chains** (Yahoo Finance via `yfinance`) for the nearest 8 expirations (≤120 DTE),
  computes volume, OI, vol/OI, estimated premium (volume × last-or-mid × 100), IV, unusual tags (Vol>OI, vol/OI ≥ 2, new OI, premium ≥ $250K),
  put/call ratios, max pain (nearest expiry), and an approximate GEX (Black-Scholes gamma × OI; dealers assumed long calls / short puts).
  Output: `data/flow.json`.
- `.github/workflows/refresh.yml` runs it every 30 min on weekdays during market hours plus after close, commits the JSON, and deploys GitHub Pages.
- `index.html` / `style.css` / `app.js` render the tape, filters, and per-ticker panel. No build step, no dependencies.

## Limitations
This is a chain **snapshot**, not a trade-by-trade tape. Sweeps, blocks and true aggressor side can't be confirmed; "side" and sentiment are inferred from
last price vs bid/ask. Data is delayed ~15 min and GitHub cron can lag. **Research from public data, not financial advice.**

Run locally: `pip install -r requirements.txt && python scripts/fetch_flow.py && python -m http.server`.
