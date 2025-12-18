#!/usr/bin/env python3
import requests
import time
import sys
import signal
import argparse

URL = "http://localhost:3001/api/hit"
running = True

def stop(sig, frame):
    global running
    print("\n\nStopping...")
    running = False

signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=URL)
    parser.add_argument("--rps", type=int, default=1000, help="Hits per second")
    parser.add_argument("--date", type=str, help="Target date YYYY-MM-DD")
    args = parser.parse_args()

    url = f"{args.url}?date={args.date}" if args.date else args.url
    delay = 1.0 / args.rps if args.rps > 0 else 0.05

    print(f"\n🚀 Traffic Generator")
    print(f"   URL: {url}")
    print(f"   Rate: {args.rps}/sec")
    print(f"   Ctrl+C to stop\n")

    total = 0
    failed = 0
    start = time.time()

    while running:
        try:
            r = requests.post(url, timeout=5)
            total += 1 if r.status_code in (200, 201, 202) else 0
            failed += 0 if r.status_code in (200, 201, 202) else 1
        except:
            failed += 1

        elapsed = time.time() - start
        rps = total / elapsed if elapsed > 0 else 0

        sys.stdout.write(f"\r⏱️ {elapsed:.0f}s | {total:,} hits | {rps:.1f}/sec | {failed} failed ")
        sys.stdout.flush()
        time.sleep(delay)

    elapsed = time.time() - start
    print(f"\n\n📊 Done: {total:,} hits in {elapsed:.1f}s\n")


if __name__ == "__main__":
    main()
