#!/usr/bin/env python3
"""
Multithreaded Traffic Generator
High-performance load testing with concurrent requests
"""
import requests
import time
import sys
import signal
import argparse
from concurrent.futures import ThreadPoolExecutor
from threading import Lock, Event
from collections import deque

URL = "http://localhost:3001/api/hit"
stop_event = Event()

# Thread-safe counters
stats_lock = Lock()
total_hits = 0
failed_hits = 0
recent_times = deque(maxlen=100)


def stop(sig, frame):
    print("\n\n⏹️  Stopping gracefully...")
    stop_event.set()


signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)


def send_hit(url: str, session: requests.Session) -> tuple[bool, float]:
    """Send a single hit and return (success, latency)"""
    if stop_event.is_set():
        return False, 0
    
    start = time.time()
    try:
        r = session.post(url, timeout=10)
        latency = time.time() - start
        success = r.status_code in (200, 201, 202)
        return success, latency
    except Exception:
        return False, time.time() - start


def worker(url: str, hits_per_worker: int, session: requests.Session):
    """Worker function that sends a specific number of hits"""
    global total_hits, failed_hits
    
    for _ in range(hits_per_worker):
        if stop_event.is_set():
            break
            
        success, latency = send_hit(url, session)
        
        with stats_lock:
            if success:
                total_hits += 1
            else:
                failed_hits += 1
            recent_times.append(latency)


def continuous_worker(url: str, session: requests.Session, delay: float):
    """Worker that continuously sends hits until stopped"""
    global total_hits, failed_hits
    
    while not stop_event.is_set():
        success, latency = send_hit(url, session)
        
        with stats_lock:
            if success:
                total_hits += 1
            else:
                failed_hits += 1
            recent_times.append(latency)
        
        if delay > 0:
            time.sleep(delay)


def main():
    global total_hits, failed_hits
    
    parser = argparse.ArgumentParser(description="Multithreaded Traffic Generator")
    parser.add_argument("--url", default=URL, help="Target URL")
    parser.add_argument("--rps", type=int, default=500, help="Target requests per second")
    parser.add_argument("--threads", type=int, default=50, help="Number of worker threads")
    parser.add_argument("--date", type=str, help="Target date YYYY-MM-DD")
    parser.add_argument("--duration", type=int, default=0, help="Duration in seconds (0 = unlimited)")
    parser.add_argument("--total", type=int, default=0, help="Total hits to send (0 = unlimited)")
    args = parser.parse_args()

    url = f"{args.url}?date={args.date}" if args.date else args.url
    delay_per_thread = args.threads / args.rps if args.rps > 0 else 0

    print(f"\n{'='*50}")
    print(f"🚀 Multithreaded Traffic Generator")
    print(f"{'='*50}")
    print(f"   URL:      {url}")
    print(f"   Threads:  {args.threads}")
    print(f"   Target:   {args.rps} req/sec")
    if args.duration > 0:
        print(f"   Duration: {args.duration}s")
    if args.total > 0:
        print(f"   Total:    {args.total:,} hits")
    print(f"{'='*50}")
    print(f"   Press Ctrl+C to stop\n")

    start_time = time.time()
    
    # Create a session per thread for connection pooling
    sessions = [requests.Session() for _ in range(args.threads)]
    
    for session in sessions:
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=10,
            pool_maxsize=10,
            max_retries=0
        )
        session.mount('http://', adapter)
        session.mount('https://', adapter)

    try:
        with ThreadPoolExecutor(max_workers=args.threads) as executor:
            if args.total > 0:
                # Finite mode: send specific number of hits
                hits_per_worker = args.total // args.threads
                remainder = args.total % args.threads
                
                futures = []
                for i, session in enumerate(sessions):
                    worker_hits = hits_per_worker + (1 if i < remainder else 0)
                    if worker_hits > 0:
                        futures.append(executor.submit(worker, url, worker_hits, session))
                
                # Monitor progress
                while not all(f.done() for f in futures) and not stop_event.is_set():
                    elapsed = time.time() - start_time
                    with stats_lock:
                        current_total = total_hits
                        current_failed = failed_hits
                        avg_latency = sum(recent_times) / len(recent_times) if recent_times else 0
                    
                    rps = current_total / elapsed if elapsed > 0 else 0
                    progress = (current_total + current_failed) / args.total * 100 if args.total > 0 else 0
                    
                    sys.stdout.write(
                        f"\r⏱️  {elapsed:6.1f}s │ "
                        f"✅ {current_total:>8,} │ "
                        f"❌ {current_failed:>5} │ "
                        f"⚡ {rps:>7.1f}/s │ "
                        f"📊 {avg_latency*1000:>5.0f}ms │ "
                        f"📈 {progress:>5.1f}%  "
                    )
                    sys.stdout.flush()
                    time.sleep(0.1)
            else:
                # Continuous mode
                futures = []
                for i, session in enumerate(sessions):
                    futures.append(executor.submit(continuous_worker, url, session, delay_per_thread))
                
                end_time = start_time + args.duration if args.duration > 0 else float('inf')
                
                while not stop_event.is_set():
                    elapsed = time.time() - start_time
                    
                    if args.duration > 0 and time.time() >= end_time:
                        stop_event.set()
                        break
                    
                    with stats_lock:
                        current_total = total_hits
                        current_failed = failed_hits
                        avg_latency = sum(recent_times) / len(recent_times) if recent_times else 0
                    
                    rps = current_total / elapsed if elapsed > 0 else 0
                    
                    remaining = ""
                    if args.duration > 0:
                        remaining = f"│ ⏳ {max(0, args.duration - elapsed):>5.0f}s "
                    
                    sys.stdout.write(
                        f"\r⏱️  {elapsed:6.1f}s │ "
                        f"✅ {current_total:>8,} │ "
                        f"❌ {current_failed:>5} │ "
                        f"⚡ {rps:>7.1f}/s │ "
                        f"📊 {avg_latency*1000:>5.0f}ms {remaining} "
                    )
                    sys.stdout.flush()
                    time.sleep(0.1)

    except Exception as e:
        print(f"\n\n❌ Error: {e}")
    finally:
        stop_event.set()
        for session in sessions:
            session.close()

    # Final stats
    elapsed = time.time() - start_time
    with stats_lock:
        final_total = total_hits
        final_failed = failed_hits
        avg_latency = sum(recent_times) / len(recent_times) if recent_times else 0
    
    final_rps = final_total / elapsed if elapsed > 0 else 0
    success_rate = final_total / (final_total + final_failed) * 100 if (final_total + final_failed) > 0 else 0

    print(f"\n\n{'='*50}")
    print(f"📊 Final Results")
    print(f"{'='*50}")
    print(f"   Duration:     {elapsed:.1f}s")
    print(f"   Total Hits:   {final_total:,}")
    print(f"   Failed:       {final_failed:,}")
    print(f"   Success Rate: {success_rate:.1f}%")
    print(f"   Avg RPS:      {final_rps:.1f}")
    print(f"   Avg Latency:  {avg_latency*1000:.0f}ms")
    print(f"{'='*50}\n")


if __name__ == "__main__":
    main()

