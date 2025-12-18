"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// ===========================================
// CONFIGURATION
// ===========================================
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";

// Days in correct order: Monday to Sunday
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ===========================================
// TYPES
// ===========================================
interface DayData {
  day: string;
  traffic: number;
}

// ===========================================
// HELPER FUNCTIONS
// ===========================================

function formatNumber(num: number): string {
  return Math.round(num).toLocaleString();
}

// Sort data to always show Mon-Sun order
function sortByDayOrder(data: DayData[]): DayData[] {
  const dayMap = new Map(data.map((d) => [d.day, d.traffic]));
  return DAY_ORDER.map((day) => ({
    day,
    traffic: dayMap.get(day) || 0,
  }));
}

// ===========================================
// SMOOTH COUNTER COMPONENT (no jerk)
// ===========================================
function SmoothCounter({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const [displayValue, setDisplayValue] = React.useState(value);
  const prevValue = React.useRef(value);
  const frameRef = React.useRef<number>();

  React.useEffect(() => {
    // Cancel any existing animation
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
    }

    const startValue = prevValue.current;
    const diff = value - startValue;

    // If no change or first render, just set
    if (diff === 0 || startValue === 0) {
      setDisplayValue(value);
      prevValue.current = value;
      return;
    }

    const duration = 200; // ms
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Smooth easing
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startValue + diff * eased;

      setDisplayValue(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        prevValue.current = value;
      }
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [value]);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {formatNumber(displayValue)}
    </span>
  );
}

// ===========================================
// LOADING SKELETON
// ===========================================
function ChartSkeleton() {
  return (
    <Card className="overflow-hidden rounded-2xl border-white/10 bg-[#0b1220] text-white">
      <CardHeader className="pb-2 p-6">
        <div className="space-y-3 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-4 w-28 bg-white/10 rounded" />
            <div className="h-4 w-12 bg-white/10 rounded" />
          </div>
          <div className="h-10 w-32 bg-white/10 rounded" />
          <div className="flex gap-4">
            <div className="h-4 w-24 bg-white/10 rounded" />
            <div className="h-4 w-20 bg-white/10 rounded" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-6 pb-4">
        <div className="h-[200px] w-full flex items-end justify-between gap-2 animate-pulse">
          {[40, 70, 50, 60, 45, 80, 55].map((h, i) => (
            <div
              key={i}
              className="flex-1 bg-gradient-to-t from-blue-500/20 to-blue-500/5 rounded-t"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ===========================================
// MAIN CHART COMPONENT
// ===========================================
export function WebsiteTrafficChart() {
  // ---- STATE ----
  const [isLoading, setIsLoading] = React.useState(true);
  const [chartData, setChartData] = React.useState<DayData[]>(
    DAY_ORDER.map((day) => ({ day, traffic: 0 }))
  );
  const [totalTraffic, setTotalTraffic] = React.useState(0);
  const [todayTraffic, setTodayTraffic] = React.useState(0);
  const [percentChange, setPercentChange] = React.useState(0);
  const [isConnected, setIsConnected] = React.useState(false);
  const [requestsPerSecond, setRequestsPerSecond] = React.useState(0);

  // ---- REFS ----
  const lastTrafficRef = React.useRef(0);
  const lastTimeRef = React.useRef(Date.now());
  const rateHistoryRef = React.useRef<number[]>([]);
  const wsRef = React.useRef<WebSocket | null>(null);

  // ---- CALCULATE REQUESTS PER SECOND ----
  const updateRequestRate = React.useCallback((currentTraffic: number) => {
    const now = Date.now();
    const timeDiff = (now - lastTimeRef.current) / 1000;

    if (timeDiff > 0.1 && lastTrafficRef.current > 0) {
      const trafficDiff = currentTraffic - lastTrafficRef.current;
      if (trafficDiff > 0) {
        const instantRate = trafficDiff / timeDiff;
        rateHistoryRef.current.push(instantRate);
        if (rateHistoryRef.current.length > 3) {
          rateHistoryRef.current.shift();
        }
        const avgRate =
          rateHistoryRef.current.reduce((a, b) => a + b, 0) /
          rateHistoryRef.current.length;
        setRequestsPerSecond(avgRate);
      }
    }

    lastTrafficRef.current = currentTraffic;
    lastTimeRef.current = now;
  }, []);

  // ---- PROCESS INCOMING DATA ----
  const processData = React.useCallback(
    (data: any) => {
      if (data.data && Array.isArray(data.data)) {
        // Sort to Mon-Sun order
        const sorted = sortByDayOrder(
          data.data.map((d: any) => ({
            day: d.day,
            traffic: d.traffic || 0,
          }))
        );
        setChartData(sorted);
      }

      setTotalTraffic(data.total || 0);
      setTodayTraffic(data.currentDay || 0);
      setPercentChange(data.percentageChange || 0);
      updateRequestRate(data.currentDay || 0);

      if (isLoading) setIsLoading(false);
    },
    [updateRequestRate, isLoading]
  );

  // ---- FETCH DATA FROM API ----
  const fetchData = React.useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/traffic`);
      if (!response.ok) return;

      const result = await response.json();
      if (result.success) {
        processData(result);
      }
    } catch (error) {
      console.error("Failed to fetch:", error);
    }
  }, [processData]);

  // ---- WEBSOCKET CONNECTION ----
  React.useEffect(() => {
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          ws.send(JSON.stringify({ type: "getTraffic" }));
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === "traffic") {
              processData(message);
            }
          } catch {
            // Ignore
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          reconnectTimer = setTimeout(connect, 2000);
        };

        ws.onerror = () => setIsConnected(false);
      } catch {
        reconnectTimer = setTimeout(connect, 2000);
      }
    };

    fetchData();
    connect();

    const pollInterval = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        fetchData();
      }
    }, 1000);

    const rateDecayInterval = setInterval(() => {
      const timeSinceUpdate = (Date.now() - lastTimeRef.current) / 1000;
      if (timeSinceUpdate > 1.5) {
        setRequestsPerSecond((prev) => (prev < 0.1 ? 0 : prev * 0.7));
      }
    }, 300);

    return () => {
      clearTimeout(reconnectTimer);
      clearInterval(pollInterval);
      clearInterval(rateDecayInterval);
      wsRef.current?.close();
    };
  }, [fetchData, processData]);

  // ---- LOADING STATE ----
  // if (isLoading) {
  //   return <ChartSkeleton />;
  // }

  // ===========================================
  // RENDER
  // ===========================================
  return (
    <Card className="overflow-hidden rounded-2xl border-white/10 bg-[#0b1220] text-white">
      <CardHeader className="pb-2 p-6">
        <div className="space-y-2">
          {/* Title */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-white/70">Website Traffic</p>
            {isConnected ? (
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-emerald-400/70">Live</span>
              </div>
            ) : (
              <span className="text-xs text-yellow-400/70">
                Reconnecting...
              </span>
            )}
          </div>

          {/* Total traffic - smooth counter */}
          <SmoothCounter
            value={totalTraffic}
            className="text-4xl font-semibold tracking-tight block"
          />

          {/* Stats row */}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-white/60">
              Last 7 Days
              {percentChange !== 0 && (
                <span
                  className={`ml-1 font-medium ${
                    percentChange >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {percentChange >= 0 ? "+" : ""}
                  {percentChange.toFixed(1)}%
                </span>
              )}
            </span>

            <span className="text-white/50">
              Today:{" "}
              <SmoothCounter
                value={todayTraffic}
                className="text-white/70 font-medium"
              />
              <span
                className={`ml-1.5 font-medium ${
                  requestsPerSecond > 0 ? "text-emerald-400" : "text-white/40"
                }`}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {requestsPerSecond > 0
                  ? `+${requestsPerSecond.toFixed(1)}/sec`
                  : "0/sec"}
              </span>
            </span>
          </div>
        </div>
      </CardHeader>

      {/* Chart */}
      <CardContent className="pt-0 px-6 pb-4">
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ left: 10, right: 10, top: 10, bottom: 0 }}
            >
              <defs>
                <linearGradient
                  id="trafficGradient"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>

              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }}
                tickMargin={10}
                interval={0}
                padding={{ left: 10, right: 10 }}
              />

              <YAxis hide domain={["dataMin - 100", "dataMax + 100"]} />

              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.1)", strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const value = payload[0]?.value as number;
                  return (
                    <div className="rounded-lg border border-white/10 bg-[#0b1220] px-3 py-2 shadow-lg">
                      <p className="text-white/60 text-xs">{label}</p>
                      <p
                        className="text-white font-semibold"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {formatNumber(value)} visits
                      </p>
                    </div>
                  );
                }}
              />

              <Area
                type="monotone"
                dataKey="traffic"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#trafficGradient)"
                animationDuration={300}
                animationEasing="ease-out"
                isAnimationActive={true}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}