import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UserMenu } from "@/components/user-menu";
import { WebsiteTrafficChart } from "@/components/website-traffic-chart";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <main className="h-screen bg-[#0a0f1c] py-4">
      <header className=" backdrop-blur-sm sticky top-0 z-50">
        <div className="flex justify-end mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <UserMenu email={user.email} name={user.user_metadata?.name} />
          </div>
        </div>
      </header>

      <div className="flex items-center justify-center h-[calc(100vh-10rem)] px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-5xl">
          <WebsiteTrafficChart />
        </div>
      </div>
    </main>
  );
}
