import requests
import time
import sys
import signal
import argparse
import threading
from datetime import datetime, timedelta
from queue import Queue
from collections import deque

URL = "https://webtraffic-graph.onrender.com/api/hit"
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
FULL_NAMES = {"mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday", "fri": "Friday", "sat": "Saturday", "sun": "Sunday"}
DEFAULT_HITS = {"mon": 1569, "tue": 1232, "wed": 2542, "thu": 540, "fri": 7984, "sat": 2345, "sun": 1234}

running = True
stats_lock = threading.Lock()

def stop(sig, frame):
    global running
    print("\n\nStopping...")
    running = False

signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)


class RateLimiter:
    """Thread-safe rate limiter using token bucket algorithm"""
    def __init__(self, rps):
        self.rps = rps
        self.tokens = rps
        self.last_update = time.time()
        self.lock = threading.Lock()
        self.min_interval = 1.0 / rps if rps > 0 else 0.001
    
    def acquire(self):
        """Wait until a token is available"""
        with self.lock:
            now = time.time()
            elapsed = now - self.last_update
            # Refill tokens based on elapsed time
            self.tokens = min(self.rps, self.tokens + elapsed * self.rps)
            self.last_update = now
            
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return True
            else:
                # Calculate wait time
                wait_time = (1.0 - self.tokens) / self.rps
                self.tokens = 0.0
                return wait_time
    
    def wait(self):
        """Block until a request can be made"""
        result = self.acquire()
        if result is True:
            return
        else:
            time.sleep(result)


def get_date(day: str) -> str:
    today = datetime.now()
    day_idx = DAYS.index(day.lower())
    diff = day_idx - today.weekday()
    if diff > 0:
        diff -= 7
    return (today + timedelta(days=diff)).strftime("%Y-%m-%d")


class Stats:
    """Thread-safe statistics tracker"""
    def __init__(self, total):
        self.total = total
        self.sent = 0
        self.success = 0
        self.start_time = time.time()
        self.lock = threading.Lock()
    
    def increment(self, success=True):
        with self.lock:
            self.sent += 1
            if success:
                self.success += 1
    
    def get_stats(self):
        with self.lock:
            elapsed = time.time() - self.start_time
            pct = (self.sent / self.total) * 100 if self.total > 0 else 0
            current_rps = self.sent / elapsed if elapsed > 0 else 0
            return self.sent, self.success, pct, current_rps, elapsed


def worker_thread(url, date, rate_limiter, stats, work_queue):
    """Worker thread that sends requests"""
    while running:
        try:
            # Get work item (just a flag, we use queue to signal work)
            work_queue.get(timeout=0.1)
            
            # Rate limit
            rate_limiter.wait()
            
            # Send request
            try:
                r = requests.post(f"{url}?date={date}", timeout=5)
                success = r.status_code in (200, 201, 202)
                stats.increment(success)
            except:
                stats.increment(False)
            
            work_queue.task_done()
            
        except:
            break


def send_hits_threaded(url: str, day: str, total: int, rps: int, num_threads: int = 50):
    """Send hits using multiple threads with rate limiting"""
    date = get_date(day)
    print(f"\n📅 {FULL_NAMES[day]} ({date}) - {total:,} hits @ {rps}/sec ({num_threads} threads)")
    
    rate_limiter = RateLimiter(rps)
    stats = Stats(total)
    work_queue = Queue()
    
    # Start worker threads
    threads = []
    for _ in range(num_threads):
        t = threading.Thread(
            target=worker_thread,
            args=(url, date, rate_limiter, stats, work_queue),
            daemon=True
        )
        t.start()
        threads.append(t)
    
    # Add work items to queue
    for _ in range(total):
        if not running:
            break
        work_queue.put(1)
    
    # Wait for completion and update progress
    last_update = time.time()
    while work_queue.unfinished_tasks > 0 and running:
        time.sleep(0.1)
        
        # Update progress display every 0.2 seconds
        if time.time() - last_update >= 0.2:
            sent, success, pct, current_rps, elapsed = stats.get_stats()
            sys.stdout.write(
                f"\r   [{sent:>5,}/{total:,}] {pct:>5.1f}% | "
                f"{current_rps:>6.1f}/sec | ✅ {success:,} "
            )
            sys.stdout.flush()
            last_update = time.time()
    
    # Wait for all work to complete
    work_queue.join()
    
    # Final stats
    sent, success, pct, current_rps, elapsed = stats.get_stats()
    print(f"\n   ✅ {success:,}/{sent:,} successful in {elapsed:.1f}s ({current_rps:.1f}/sec avg)")
    
    return success


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=URL)
    parser.add_argument("--rps", type=int, default=500, help="Target requests per second")
    parser.add_argument("--threads", type=int, default=50, help="Number of worker threads")
    parser.add_argument("--day", type=str, help="mon,tue,wed...")
    args = parser.parse_args()

    days = [(d.strip().lower(), DEFAULT_HITS[d.strip().lower()]) for d in args.day.split(",")] if args.day else [(d, DEFAULT_HITS[d]) for d in DAYS]

    for d, _ in days:
        if d not in DAYS:
            print(f"Invalid day: {d}")
            return

    print(f"\n🗓️ Mock Week (Multi-threaded)")
    print(f"   {args.rps}/sec | {args.threads} threads | {sum(h for _, h in days):,} total hits")
    print("   Ctrl+C to stop")

    total = 0
    start = time.time()

    for day, hits in days:
        if not running:
            break
        total += send_hits_threaded(args.url, day, hits, args.rps, args.threads)

    print(f"\n📊 Done: {total:,} hits in {time.time() - start:.1f}s\n")


if __name__ == "__main__":
    main()

