import { WebsiteTrafficChart } from "@/components/website-traffic-chart"

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0f1c] p-3 sm:p-4 md:p-6 lg:p-8">
      <div className="w-full max-w-sm sm:max-w-2xl md:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
        <WebsiteTrafficChart />
      </div>
    </main>
  )
}

