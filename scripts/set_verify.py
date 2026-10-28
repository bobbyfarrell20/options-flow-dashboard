#!/usr/bin/env python3
"""Set per-ticker cross-check status shown on the dashboard, then commit + push ONLY data/verify.json.

Usage:
  python scripts/set_verify.py MU=off TSLA=ok          # statuses: ok | off | unchecked
  python scripts/set_verify.py ALL=unchecked            # reset every ticker
  python scripts/set_verify.py --no-push MU=ok          # update the file locally only
  python scripts/set_verify.py --final MU=ok TSLA=off   # post-close: record TODAY's final status in the per-day history
  python scripts/set_verify.py --day 2026-10-28 --final MU=ok   # record (or fix) a given session's final status

Intraday calls update the live status (shown on chips, the Net flow card and the 5-day "Today" column).
--final records a session's final status in "days" (shown on that day's 5-day cell); for today it also updates
the live status. unchecked with --final removes that ticker from the day. History keeps the last KEEP_DAYS sessions.

The public file holds a status per ticker and a timestamp - never any outside numbers, direction or source.
The GitHub Actions refresh workflow does not touch this file. Checks from a previous ET day are shown as unchecked.
"""
import datetime as dt, json, os, re, subprocess, sys, time
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "data", "verify.json")
STATUSES = {"ok", "off", "unchecked"}
KEEP_DAYS = 10

def watchlist():
    m = re.search(r"const WATCH=(\[.*?\]);", open(os.path.join(ROOT, "app.js")).read())
    return json.loads(m.group(1))

def git(*a, check=True):
    return subprocess.run(["git", "-C", ROOT, *a], check=check, capture_output=True, text=True)

def parse(args, watch):
    out = {}
    for a in args:
        if "=" not in a: sys.exit(f"bad argument {a!r}: use TICKER=ok|off|unchecked")
        t, s = a.split("=", 1); t, s = t.strip().upper(), s.strip().lower()
        if s not in STATUSES: sys.exit(f"bad status {s!r} for {t}: use ok, off or unchecked")
        if t == "ALL": out.update({w: s for w in watch}); continue
        if t not in watch: sys.exit(f"{t} is not on the watchlist: {', '.join(watch)}")
        out[t] = s
    if not out: sys.exit(__doc__)
    return out

def apply(changes, watch, day=None):
    try: v = json.load(open(PATH))
    except Exception: v = {"checked_at": None, "tickers": {}}
    nowdt = dt.datetime.now(ZoneInfo("America/New_York")); now = nowdt.isoformat(timespec="seconds")
    days = v.setdefault("days", {})
    if day:
        row = days.setdefault(day, {})
        for t, s in changes.items():
            if s == "unchecked": row.pop(t, None)
            else: row[t] = s
        if not row: days.pop(day)
        for k in sorted(days)[:-KEEP_DAYS]: del days[k]
        v["days"] = {k: {w: days[k][w] for w in watch if w in days[k]} for k in sorted(days)}
        if day != nowdt.date().isoformat():          # past session: history only, live status untouched
            with open(PATH, "w") as fh: json.dump(v, fh, indent=1); fh.write("\n")
            return now
    tk = v.setdefault("tickers", {})
    for w in watch: tk.setdefault(w, {"status": "unchecked", "checked_at": None})
    for t, s in changes.items(): tk[t] = {"status": s, "checked_at": None if s == "unchecked" else now}
    v["checked_at"] = now
    v["tickers"] = {w: tk[w] for w in watch}          # drop tickers no longer on the watchlist, keep order
    v["days"] = {k: v["days"][k] for k in sorted(v.get("days", {}))}
    with open(PATH, "w") as fh: json.dump(v, fh, indent=1); fh.write("\n")
    return now

def main():
    args = sys.argv[1:]; push = "--no-push" not in args; final = "--final" in args; day = None
    if "--day" in args:
        i = args.index("--day"); day = args[i + 1] if i + 1 < len(args) else ""; del args[i:i + 2]
        try: dt.date.fromisoformat(day)
        except ValueError: sys.exit(f"--day needs YYYY-MM-DD, got {day!r}")
        if not final: sys.exit("--day only works with --final (it records a session's final status)")
    args = [a for a in args if a not in ("--no-push", "--final")]
    if final and not day: day = dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    watch = watchlist(); changes = parse(args, watch)
    if push: git("pull", "--rebase", "--autostash", "-q")
    now = apply(changes, watch, day)
    print("verify.json:", ", ".join(f"{t}={s}" for t, s in changes.items()), f"final for {day}" if day else "live", "at", now)
    if not push: return
    rel = "data/verify.json"
    git("add", rel)
    if git("diff", "--cached", "--quiet", "--", rel, check=False).returncode == 0: print("no change"); return
    git("commit", "-q", "-m", "verify" + (f" final {day}" if day else "") + ": " + " ".join(f"{t}={s}" for t, s in changes.items()), "--", rel)
    for i in range(6):
        r = git("push", "-q", "origin", "HEAD:main", check=False)
        if r.returncode == 0: print("pushed", git("rev-parse", "--short", "HEAD").stdout.strip()); return
        print("push rejected, rebasing and retrying...", r.stderr.strip().splitlines()[-1:] )
        p = git("pull", "--rebase", "--autostash", "-q", check=False)
        if p.returncode != 0:          # verify.json conflict: re-apply our statuses on top of the remote version
            git("checkout", "--theirs", rel, check=False); apply(changes, watch, day); git("add", rel)
            git("-c", "core.editor=true", "rebase", "--continue", check=False)
        time.sleep(2 + 2 * i)
    sys.exit("push failed after retries; run again")

if __name__ == "__main__": main()
