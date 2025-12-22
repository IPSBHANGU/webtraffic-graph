"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface UserMenuProps {
  email: string | undefined;
  name?: string | undefined;
}

export function UserMenu({ email, name }: UserMenuProps) {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    window.location.href = "/auth/login";
  };

  const displayName = name || email?.split("@")[0] || "User";
  const initials = email?.charAt(0).toUpperCase() || "U";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="h-11 w-11 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-md font-medium hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-white/20">
          {initials}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-4">
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-white">{displayName}</p>
            <p className="text-xs text-white/60">{email}</p>
          </div>
          <div className="border-t border-white/10 pt-4">
            <Button variant="outline" className="w-full" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
