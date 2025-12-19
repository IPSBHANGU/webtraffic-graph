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
import { parseDate } from "chrono-node";
import { CalendarIcon, X } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";

// ===========================================
// CONFIGURATION
// ===========================================
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://webtraffic-graph.onrender.com";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "wss://webtraffic-graph.onrender.com";

// Days in correct order: Monday to Sunday
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ===========================================
// TYPES
// ===========================================
type TimePeriod = "week" | "custom";
type DeviceMode = "unified" | "split";

interface DayData {
  day: string;
  traffic: number;
  date?: string;
}

interface ChartDataPoint {
  label: string;
  traffic: number;
  ios?: number;
  android?: number;
}

interface CustomDateData {
  date: string;
  day: string;
  traffic: number;
}

// ===========================================
// HELPER FUNCTIONS
// ===========================================

function formatNumber(num: number): string {
  return Math.round(num).toLocaleString();
}

// Sort data chronologically by date (oldest to newest)
function sortByDate(data: DayData[]): DayData[] {
  return [...data].sort((a, b) => {
    if (!a.date || !b.date) return 0;
    return a.date.localeCompare(b.date);
  });
}

// Transform daily data for chart - preserves chronological order from backend
function transformDailyData(data: DayData[]): ChartDataPoint[] {
  // Backend already returns chronological order, but ensure it's sorted by date
  const sorted = sortByDate(data);
  return sorted.map((d) => ({
    label: d.day,
    traffic: d.traffic,
  }));
}

// Transform custom date data for chart
function transformCustomDateData(data: CustomDateData[]): ChartDataPoint[] {
  return data.map((d) => {
    // Format date as "Dec 19" style
    const date = new Date(d.date);
    const month = date.toLocaleDateString("en-US", { month: "short" });
    const day = date.getDate();
    return {
      label: `${month} ${day}`,
      traffic: d.traffic,
    };
  });
}

// Format date for display
function formatDateDisplay(date: Date | undefined): string {
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Format date for API (YYYY-MM-DD)
function formatDateAPI(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
// DATE RANGE PICKER COMPONENT
// ===========================================
function DateRangePicker({
  dateRange,
  onDateRangeChange,
  defaultOpen = false,
}: {
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [value, setValue] = React.useState("");
  const [month, setMonth] = React.useState<Date | undefined>(
    dateRange?.from || new Date()
  );

  // Update display when calendar selection changes
  React.useEffect(() => {
    if (dateRange?.from && dateRange?.to) {
      if (dateRange.from.getTime() === dateRange.to.getTime()) {
        setValue(formatDateDisplay(dateRange.from));
      } else {
        setValue(
          `${formatDateDisplay(dateRange.from)} - ${formatDateDisplay(dateRange.to)}`
        );
      }
    } else if (dateRange?.from) {
      setValue(formatDateDisplay(dateRange.from));
    }
  }, [dateRange]);

  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex items-center gap-1">
        <Input
          id="date"
          value={value}
          placeholder="e.g. last week"
          className="bg-[#0d1829] pr-7 h-6 text-[10px] border-white/10 w-28"
          onChange={(e) => {
            setValue(e.target.value);
            const date = parseDate(e.target.value);
            if (date) {
              onDateRangeChange({ from: date, to: date });
              setMonth(date);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-0.5 h-6 w-6 -translate-y-1/2 hover:bg-white/10 rounded"
            >
              <CalendarIcon className="size-4 text-white/60" />
              <span className="sr-only">Select date</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto overflow-hidden p-0" align="end">
            <Calendar
              mode="range"
              selected={dateRange}
              month={month}
              onMonthChange={setMonth}
              onSelect={(range) => {
                onDateRangeChange(range);
                if (range?.from && range?.to) {
                  setOpen(false);
                }
              }}
              numberOfMonths={1}
            />
            {dateRange?.from && (
              <div className="border-t border-white/10 p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs text-white/60 hover:text-white hover:bg-white/10"
                  onClick={() => {
                    onDateRangeChange(undefined);
                    setValue("");
                    setOpen(false);
                  }}
                >
                  <X className="size-3 mr-1" />
                  Clear selection
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {dateRange?.from && (
        <div className="text-white/40 text-[10px]">
          Showing{" "}
          <span className="text-white/60 font-medium">
            {dateRange.to && dateRange.from.getTime() !== dateRange.to.getTime()
              ? `${formatDateDisplay(dateRange.from)} to ${formatDateDisplay(dateRange.to)}`
              : formatDateDisplay(dateRange.from)}
          </span>
        </div>
      )}
    </div>
  );
}

// ===========================================
// MAIN CHART COMPONENT
// ===========================================
export function WebsiteTrafficChart() {
  // ---- STATE ----
  const [isLoading, setIsLoading] = React.useState(true);
  const [timePeriod, setTimePeriod] = React.useState<TimePeriod>("week");
  const [deviceMode, setDeviceMode] = React.useState<DeviceMode>("unified");

  // Raw data from API
  const [dailyData, setDailyData] = React.useState<DayData[]>(
    DAY_ORDER.map((day) => ({ day, traffic: 0 }))
  );
  const [customData, setCustomData] = React.useState<CustomDateData[]>([]);

  const [totalTraffic, setTotalTraffic] = React.useState(0);
  const [todayTraffic, setTodayTraffic] = React.useState(0);
  const [percentChange, setPercentChange] = React.useState(0);
  const [isConnected, setIsConnected] = React.useState(false);
  const [requestsPerSecond, setRequestsPerSecond] = React.useState(0);

  // Custom date range state
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(
    undefined
  );
  const [customTotal, setCustomTotal] = React.useState(0);
  const [isLoadingCustom, setIsLoadingCustom] = React.useState(false);

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
      // Process daily data
      if (data.data && Array.isArray(data.data)) {
        // Keep chronological order from backend (oldest to newest)
        // Backend already returns data in chronological order
        const dailyDataWithDates = data.data.map((d: any) => ({
          day: d.day,
          traffic: d.traffic || 0,
          date: d.date, // Preserve date for chronological sorting
        }));
        setDailyData(dailyDataWithDates);
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

  // ---- FETCH CUSTOM DATE RANGE DATA ----
  const fetchCustomData = React.useCallback(async () => {
    if (!dateRange?.from) return;

    setIsLoadingCustom(true);
    try {
      const startDate = formatDateAPI(dateRange.from);
      const endDate = dateRange.to
        ? formatDateAPI(dateRange.to)
        : formatDateAPI(dateRange.from);

      const response = await fetch(
        `${API_URL}/api/custom-range?start=${startDate}&end=${endDate}`
      );

      if (!response.ok) return;

      const result = await response.json();
      if (result.success) {
        setCustomData(result.data);
        setCustomTotal(result.total);
      }
    } catch (error) {
      console.error("Failed to fetch custom data:", error);
    } finally {
      setIsLoadingCustom(false);
    }
  }, [dateRange]);

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

  // ---- FETCH CUSTOM DATA WHEN DATE RANGE CHANGES ----
  React.useEffect(() => {
    if (timePeriod === "custom" && dateRange?.from) {
      fetchCustomData();
    }
  }, [timePeriod, dateRange, fetchCustomData]);

  // ---- GET CHART DATA BASED ON TIME PERIOD ----
  const chartData = React.useMemo((): ChartDataPoint[] => {
    let baseData: ChartDataPoint[];

    switch (timePeriod) {
      case "week":
        baseData = transformDailyData(dailyData);
        break;
      case "custom":
        baseData = transformCustomDateData(customData);
        break;
      default:
        baseData = transformDailyData(dailyData);
    }

    // Add iOS and Android split data (65% iOS, 35% Android)
    if (deviceMode === "split") {
      return baseData.map((point) => ({
        ...point,
        ios: Math.round(point.traffic * 0.65),
        android: Math.round(point.traffic * 0.35),
      }));
    }

    return baseData;
  }, [timePeriod, dailyData, customData, deviceMode]);

  // ---- GET PERIOD LABEL ----
  const periodLabel = React.useMemo(() => {
    switch (timePeriod) {
      case "week":
        return "Last 7 Days";
      case "custom":
        if (dateRange?.from && dateRange?.to) {
          if (dateRange.from.getTime() === dateRange.to.getTime()) {
            return formatDateDisplay(dateRange.from);
          }
          const daysDiff = Math.ceil(
            (dateRange.to.getTime() - dateRange.from.getTime()) /
              (1000 * 60 * 60 * 24)
          );
          return `${daysDiff + 1} Days`;
        }
        return "Select dates";
      default:
        return "Last 7 Days";
    }
  }, [timePeriod, dateRange]);

  // ---- GET PERIOD TOTAL ----
  const periodTotal = React.useMemo(() => {
    switch (timePeriod) {
      case "week":
        return totalTraffic;
      case "custom":
        return customTotal;
      default:
        return totalTraffic;
    }
  }, [timePeriod, totalTraffic, customTotal]);

  // ===========================================
  // RENDER
  // ===========================================
  return (
    <Card className="overflow-hidden rounded-2xl border-white/10 bg-[#0b1220] text-white">
      <CardHeader className="pb-2 p-6">
        <div className="space-y-2">
          {/* Title row with Live indicator */}
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

          {/* Total + Tabs row */}
          <div className="flex items-start justify-between">
            {/* Total traffic - smooth counter */}
            <div className="flex flex-col gap-1">
              <SmoothCounter
                value={periodTotal}
                className="text-4xl font-semibold tracking-tight block"
              />
              {isLoadingCustom && timePeriod === "custom" && (
                <span className="text-xs text-white/40">Loading...</span>
              )}
            </div>

            {/* Tab bars */}
            <div className="flex flex-col gap-1.5 items-end">
              {/* Time Period Tabs */}
              <Tabs
                value={timePeriod}
                onValueChange={(v) => setTimePeriod(v as TimePeriod)}
              >
                <TabsList className="h-7 p-0.5 gap-0.5">
                  <TabsTrigger value="week" className="h-6 px-2 text-[11px]">
                    Week
                  </TabsTrigger>
                  <TabsTrigger value="custom" className="h-6 px-2 text-[11px]">
                    Custom
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Device Mode Tabs */}
              <Tabs
                value={deviceMode}
                onValueChange={(v) => setDeviceMode(v as DeviceMode)}
              >
                <TabsList className="h-7 p-0.5 gap-0.5">
                  <TabsTrigger value="unified" className="h-6 px-2 text-[11px]">
                    Unified
                  </TabsTrigger>
                  <TabsTrigger value="split" className="h-6 px-2 text-[11px]">
                    Split
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* Custom Date Picker - show when custom is selected */}
          {timePeriod === "custom" && (
            <DateRangePicker
              key="custom-date-picker"
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              defaultOpen={true}
            />
          )}

          {/* Stats row */}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-white/60">
              {periodLabel}
              {percentChange !== 0 && timePeriod === "week" && (
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

            {timePeriod === "week" && (
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
            )}

            {timePeriod === "custom" && customData.length > 0 && (
              <span className="text-white/50">
                {customData.length} {customData.length === 1 ? "day" : "days"}{" "}
                selected
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Chart */}
      <CardContent className="pt-0 px-6 pb-4">
        <div className="h-[200px] w-full">
          {timePeriod === "custom" && customData.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-white/40 text-sm">
                Select a date range to view traffic data
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ left: 10, right: 10, top: 10, bottom: 0 }}
              >
                <defs>
                  {/* Unified gradient (blue) */}
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
                  {/* iOS gradient (blue) */}
                  <linearGradient
                    id="iosGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  {/* Android gradient (orange) */}
                  <linearGradient
                    id="androidGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>

                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }}
                  tickMargin={10}
                  interval={
                    timePeriod === "custom" && customData.length > 10
                      ? Math.floor(customData.length / 7)
                      : 0
                  }
                  padding={{ left: 10, right: 10 }}
                />

                <YAxis hide domain={["dataMin - 100", "dataMax + 100"]} />

                <Tooltip
                  cursor={{ stroke: "rgba(255,255,255,0.1)", strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;

                    if (deviceMode === "split") {
                      const iosValue = payload.find((p) => p.dataKey === "ios")
                        ?.value as number;
                      const androidValue = payload.find(
                        (p) => p.dataKey === "android"
                      )?.value as number;
                      return (
                        <div className="rounded-lg border border-white/10 bg-[#0b1220] px-3 py-2 shadow-lg">
                          <p className="text-white/60 text-xs mb-1">{label}</p>
                          <div className="flex items-center gap-2 mb-1">
                            <div className="h-2 w-2 rounded-full bg-blue-500" />
                            <p
                              className="text-white font-semibold text-sm"
                              style={{ fontVariantNumeric: "tabular-nums" }}
                            >
                              iOS: {formatNumber(iosValue)} visits
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-orange-500" />
                            <p
                              className="text-white font-semibold text-sm"
                              style={{ fontVariantNumeric: "tabular-nums" }}
                            >
                              Android: {formatNumber(androidValue)} visits
                            </p>
                          </div>
                        </div>
                      );
                    }

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

                {deviceMode === "unified" ? (
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
                ) : (
                  <>
                    <Area
                      type="monotone"
                      dataKey="ios"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#iosGradient)"
                      animationDuration={300}
                      animationEasing="ease-out"
                      isAnimationActive={true}
                      name="iOS"
                    />
                    <Area
                      type="monotone"
                      dataKey="android"
                      stroke="#f97316"
                      strokeWidth={2}
                      fill="url(#androidGradient)"
                      animationDuration={300}
                      animationEasing="ease-out"
                      isAnimationActive={true}
                      name="Android"
                    />
                  </>
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Device Legend - only show in split mode */}
        {deviceMode === "split" && (
          <div className="w-full flex items-center justify-center gap-6 mt-3 pt-3 border-t border-white/5">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
              <span className="text-xs text-white/70">iOS</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-orange-500" />
              <span className="text-xs text-white/70">Android</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
