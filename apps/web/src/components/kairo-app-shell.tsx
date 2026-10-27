"use client";

import * as React from "react";
import { motion } from "motion/react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { apiFetch, type PublicUser } from "@/lib/api";
import { KairoSidebar } from "@/components/kairo-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<PublicUser | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    apiFetch<{ user: PublicUser }>("/auth/me")
      .then((r) => {
        if (!cancelled) setUser(r.user);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-transparent text-neutral-950">
        <KairoSidebar user={user} />
        {/* Ensure this column takes up all remaining space and is full width */}
        <div className="flex flex-1 flex-col min-w-0 w-full">
          <motion.header
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
            className="sticky top-0 z-40 border-b border-neutral-200/70 bg-white/85 px-4 py-3 backdrop-blur-xl md:px-8 w-full"
          >
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-neutral-500 transition-colors hover:text-neutral-950" />
            </div>
          </motion.header>
          {/* w-full and flex-1 ensure children fill the entire green area */}
          <main className="flex-1 flex flex-col w-full overflow-x-hidden">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
