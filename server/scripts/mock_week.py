import requests
import time
import sys
import signal
import argparse
from datetime import datetime, timedelta

URL = "https://webtraffic-graph.onrender.com/api/hit"
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
FULL_NAMES = {"mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday", "fri": "Friday", "sat": "Saturday", "sun": "Sunday"}
DEFAULT_HITS = {"mon": 2569, "tue": 1232, "wed": 6542, "thu": 2340, "fri": 7984, "sat": 2345, "sun": 1234}

running = True

def stop(sig, frame):
    global running
    print("\n\nStopping...")
    running = False

signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)


def get_date(day: str) -> str:
    today = datetime.now()
    day_idx = DAYS.index(day.lower())
    diff = day_idx - today.weekday()
    if diff > 0:
        diff -= 7
    return (today + timedelta(days=diff)).strftime("%Y-%m-%d")


def send_hits(url: str, day: str, total: int, rps: int):
    date = get_date(day)
    print(f"\n📅 {FULL_NAMES[day]} ({date}) - {total:,} hits @ {rps}/sec")

    delay = 1.0 / rps if rps > 0 else 0.05
    sent = 0
    start = time.time()

    while sent < total and running:
        try:
            r = requests.post(f"{url}?date={date}", timeout=5)
            sent += 1 if r.status_code in (200, 201, 202) else 0
        except:
            pass

        elapsed = time.time() - start
        pct = (sent / total) * 100
        sys.stdout.write(f"\r   [{sent:>5,}/{total:,}] {pct:>5.1f}% | {sent/elapsed:.1f}/sec ")
        sys.stdout.flush()
        time.sleep(delay)

    print(f"\n   ✅ {sent:,} hits in {time.time() - start:.1f}s")
    return sent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=URL)
    parser.add_argument("--rps", type=int, default=500)
    parser.add_argument("--day", type=str, help="mon,tue,wed...")
    args = parser.parse_args()

    days = [(d.strip().lower(), DEFAULT_HITS[d.strip().lower()]) for d in args.day.split(",")] if args.day else [(d, DEFAULT_HITS[d]) for d in DAYS]

    for d, _ in days:
        if d not in DAYS:
            print(f"Invalid day: {d}")
            return

    print(f"\n🗓️ Mock Week")
    print(f"   {args.rps}/sec | {sum(h for _, h in days):,} total hits")
    print("   Ctrl+C to stop")

    total = 0
    start = time.time()

    for day, hits in days:
        if not running:
            break
        total += send_hits(args.url, day, hits, args.rps)

    print(f"\n📊 Done: {total:,} hits in {time.time() - start:.1f}s\n")


if __name__ == "__main__":
    main()
