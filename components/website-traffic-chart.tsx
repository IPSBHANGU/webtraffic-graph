"use client"

import * as React from "react"
import { Area, AreaChart, XAxis, Tooltip, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"

const chartData = [
  { day: "Mon", traffic: 3200 },
  { day: "Tue", traffic: 2800 },
  { day: "Wed", traffic: 3100 },
  { day: "Thu", traffic: 2950 },
  { day: "Fri", traffic: 2300 },
  { day: "Sat", traffic: 3700 },
  { day: "Sun", traffic: 3350 },
]

const chartConfig = {
  traffic: {
    label: "Traffic",
    color: "hsl(217 91% 60%)", // blue
  },
} satisfies ChartConfig

export function WebsiteTrafficChart() {
  const [chartMargins, setChartMargins] = React.useState({ left: 8, right: 8, top: 8, bottom: 8 })
  const [strokeWidth, setStrokeWidth] = React.useState(2)
  const [activeDotRadius, setActiveDotRadius] = React.useState(3)

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
          <p className="text-xs sm:text-sm font-medium text-white/70">Website Traffic</p>

          <div className="flex items-baseline gap-3">
            <div className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">12,345</div>
          </div>

          <div className="text-[10px] sm:text-xs text-white/60">
            Last 7 Days{" "}
            <span className="ml-1 font-medium text-emerald-400">+12.5%</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 px-3 sm:px-6 md:px-8">
        <ChartContainer config={chartConfig} className="h-[160px] sm:h-[180px] md:h-[190px] lg:h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart 
              data={chartData} 
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
                dataKey="day"
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
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

