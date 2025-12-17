"use client"

import * as React from "react"
import { Area, AreaChart, XAxis, Tooltip, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"

const chartConfig = {
  traffic: {
    label: "Traffic",
    color: "hsl(217 91% 60%)", // blue
  },
} satisfies ChartConfig

interface TrafficData {
  date: string
  day: string
  traffic: number
  isCurrentDay?: boolean // Flag to indicate if this is the current day (real-time updates)
}

interface HourlyData {
  hour: number
  minute?: number
  label: string
  traffic: number
  timestamp: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080'

export function WebsiteTrafficChart() {
  const [chartData, setChartData] = React.useState<TrafficData[]>([
    { date: "", day: "Mon", traffic: 0 },
    { date: "", day: "Tue", traffic: 0 },
    { date: "", day: "Wed", traffic: 0 },
    { date: "", day: "Thu", traffic: 0 },
    { date: "", day: "Fri", traffic: 0 },
    { date: "", day: "Sat", traffic: 0 },
    { date: "", day: "Sun", traffic: 0 },
  ])
  const [hourlyData, setHourlyData] = React.useState<HourlyData[]>([])
  const [totalTraffic, setTotalTraffic] = React.useState(0)
  const [percentageChange, setPercentageChange] = React.useState(0)
  const [currentDayTraffic, setCurrentDayTraffic] = React.useState(0)
  const [isConnected, setIsConnected] = React.useState(false)
  const [lastUpdateTime, setLastUpdateTime] = React.useState(Date.now())
  const [requestRate, setRequestRate] = React.useState(0)
  const [chartMargins, setChartMargins] = React.useState({ left: 8, right: 8, top: 8, bottom: 8 })
  const [strokeWidth, setStrokeWidth] = React.useState(2)
  const [activeDotRadius, setActiveDotRadius] = React.useState(3)
  const wsRef = React.useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const previousDataRef = React.useRef<string>('')
  const previousCurrentDayRef = React.useRef<number>(0)
  const lastTrafficUpdateRef = React.useRef<number>(Date.now())


  const fetchInitialData = React.useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/traffic`)
      if (response.ok) {
        const result = await response.json()
        if (result.success && result.data) {
          setChartData(result.data || [])
          setHourlyData(result.hourlyData || [])
          setTotalTraffic(result.total || 0)
          setCurrentDayTraffic(result.currentDay || 0)
          previousCurrentDayRef.current = result.currentDay || 0
          setPercentageChange(result.percentageChange || 0)
        }
      }
    } catch (error) {
      console.error('Error fetching initial traffic data:', error)
    }
  }, [])

  React.useEffect(() => {
    const connectWebSocket = () => {
      try {
        const ws = new WebSocket(WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          console.log('WebSocket connected')
          setIsConnected(true)
          ws.send(JSON.stringify({ type: 'getTraffic' }))
        }

        ws.onmessage = (event) => {
          try {
            if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
              return
            }

            const message = JSON.parse(event.data)
            if (message.type === 'traffic' && message.data) {
              const dataString = JSON.stringify(message.data)
              const hasDataChanged = dataString !== previousDataRef.current
              
              if (hasDataChanged) {
                setChartData(message.data || [])
                previousDataRef.current = dataString
              }
              
              setHourlyData(message.hourlyData || [])
              
              const currentDay = message.currentDay || 0
              const now = Date.now()
              
              if (currentDay !== previousCurrentDayRef.current) {
                const timeDiff = (now - lastTrafficUpdateRef.current) / 1000
                if (timeDiff > 0) {
                  const trafficDiff = currentDay - previousCurrentDayRef.current
                  const rate = trafficDiff / timeDiff
                  setRequestRate(rate)
                }
                lastTrafficUpdateRef.current = now
                previousCurrentDayRef.current = currentDay
              } else {
                const timeSinceLastUpdate = (now - lastTrafficUpdateRef.current) / 1000
                if (timeSinceLastUpdate > 2) {
                  setRequestRate(0)
                }
              }
              
              setTotalTraffic(message.total || 0)
              setCurrentDayTraffic(currentDay)
              setPercentageChange(message.percentageChange || 0)
              setLastUpdateTime(message.timestamp || Date.now())
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error)
          }
        }

        ws.onerror = (error) => {
          console.error('WebSocket error:', error)
          setIsConnected(false)
        }

        ws.onclose = () => {
          console.log('WebSocket disconnected')
          setIsConnected(false)
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket()
          }, 3000)
        }
      } catch (error) {
        console.error('Error connecting WebSocket:', error)
        setIsConnected(false)
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket()
        }, 3000)
      }
    }

    fetchInitialData()
    
    connectWebSocket()


    const fallbackInterval = setInterval(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        fetchInitialData()
      }
    }, 2000)

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
      clearInterval(fallbackInterval)
    }
  }, [fetchInitialData])

  React.useEffect(() => {
    const updateChartSettings = () => {
      if (window.innerWidth >= 1024) {
        // Desktop
        setChartMargins({ left: 20, right: 20, top: 8, bottom: 12 })
        setStrokeWidth(3)
        setActiveDotRadius(4)
      } else if (window.innerWidth >= 768) {
        // Tablet
        setChartMargins({ left: 12, right: 12, top: 8, bottom: 10 })
        setStrokeWidth(2.5)
        setActiveDotRadius(4)
      } else {
        // Mobile
        setChartMargins({ left: 15, right: 15, top: 8, bottom: 8 })
        setStrokeWidth(2)
        setActiveDotRadius(3)
      }
    }

    updateChartSettings()
    window.addEventListener('resize', updateChartSettings)
    return () => window.removeEventListener('resize', updateChartSettings)
  }, [])

  return (
    <Card className="overflow-hidden rounded-xl sm:rounded-2xl border-white/10 bg-[#0b1220] text-white shadow-sm">
      <CardHeader className="pb-2 p-4 sm:p-6">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-sm font-medium text-white/70">Website Traffic</p>
          </div>

          <div className="flex items-baseline gap-3">
            <div className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
              {totalTraffic.toLocaleString()}
            </div>
            {isConnected ? (
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title="Live updates active"></div>
                <span className="text-[10px] text-emerald-400/70 hidden sm:inline">Live</span>
              </div>
            ) : (
              <div className="text-xs text-yellow-400/70" title="Reconnecting...">
                ⚠
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-[10px] sm:text-xs text-white/60">
              Last 7 Days{" "}
              {percentageChange !== 0 && (
                <span className={`ml-1 font-medium ${percentageChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {percentageChange >= 0 ? '+' : ''}{percentageChange.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="text-[10px] sm:text-xs text-white/50">
              Today: <span className="font-medium text-white/70">{currentDayTraffic.toLocaleString()}</span>
              {requestRate > 0 ? (
                <span className="ml-1.5 text-emerald-400 font-medium">
                  +{requestRate.toFixed(1)}/sec
                </span>
              ) : (
                <span className="ml-1.5 text-white/40">
                  0/sec
                </span>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 px-3 sm:px-6 md:px-8">
        <ChartContainer config={chartConfig} className="h-[160px] sm:h-[180px] md:h-[190px] lg:h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart 
              data={chartData.map(d => ({ label: d.day, traffic: d.traffic }))}
              margin={chartMargins}
            >
              <defs>
                <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={0.35} />
                  <stop offset="55%" stopColor="hsl(217 91% 60%)" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity={0} />
                </linearGradient>
                <filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={0}
                tick={{ 
                  fill: "rgba(255,255,255,0.55)", 
                  fontSize: 10 
                }}
                className="[&_.recharts-cartesian-axis-tick_text]:!text-[10px] sm:[&_.recharts-cartesian-axis-tick_text]:!text-xs"
              />

              <Tooltip
                cursor={false}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const v = payload[0]?.value as number
                  return (
                    <div className="rounded-lg sm:rounded-xl border border-white/10 bg-[#0b1220]/95 px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-white shadow-sm">
                      <div className="text-white/70">{label}</div>
                      <div className="mt-0.5 font-medium">{v.toLocaleString()} visits</div>
                    </div>
                  )
                }}
              />

              <Area
                type="natural"
                dataKey="traffic"
                stroke="hsl(217 91% 60%)"
                strokeWidth={strokeWidth}
                fill="url(#trafficFill)"
                filter="url(#lineGlow)"
                dot={false}
                activeDot={{ r: activeDotRadius }}
                isAnimationActive={true}
                animationDuration={300}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

