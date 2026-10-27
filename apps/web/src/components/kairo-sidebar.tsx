"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import type { LucideIcon } from "lucide-react";
import {
  GitBranch,
  MessagesSquare,
  LayoutDashboard,
  LogOut,
  RotateCw,
  Send,
} from "lucide-react";
import { apiFetch, githubLoginUrl, type PublicUser } from "@/lib/api";
import { safeAvatarUrl } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const NAV: {
  title: string;
  href: string;
  icon: LucideIcon;
  external?: boolean;
}[] = [
  { title: "Agent", href: "/agent", icon: MessagesSquare },
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    title: "GitHub",
    href: githubLoginUrl,
    icon: GitBranch,
    external: true,
  },
];

export function KairoSidebar({ user }: { user: PublicUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = React.useState(false);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };

  const avatarUrl = safeAvatarUrl(user?.avatarUrl ?? null);
  const displayName = user?.name || user?.username || "Sign in with GitHub";

  return (
    <Sidebar
      collapsible="icon"
      variant="sidebar"
      className="border-r border-neutral-200/70 backdrop-blur-xl"
    >
      <SidebarHeader className="gap-6 border-b border-transparent px-6 py-6">
        <div className="nav-brand group flex shrink-0 items-center gap-2.5">
          <span className="flex size-9 items-center justify-center overflow-hidden rounded-xl bg-orange-500 transition-transform duration-300 group-hover:rotate-[-5deg] group-hover:scale-105">
            <img
              src="/kairo_logo.jpg"
              alt="logo"
              className="size-full object-cover"
            />
          </span>

          <span className="text-[19px] font-semibold tracking-[-0.8px] text-neutral-900">
            Kairo
            <span className="text-orange-500">.</span>
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-medium uppercase tracking-widest text-neutral-400">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item, i) => {
                const active = item.external
                  ? false
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <motion.li
                    key={item.href}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: 0.08 * i,
                      duration: 0.45,
                      ease: [0.23, 1, 0.32, 1],
                    }}
                  >
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.title}
                      className="cursor-pointer text-sm text-neutral-600 hover:text-neutral-950 data-[active=true]:bg-orange-50 data-[active=true]:text-orange-600"
                      render={
                        item.external ? (
                          <a href={item.href} target="_blank" rel="noreferrer">
                            <Icon className="size-4" />
                            <span>{item.title}</span>
                          </a>
                        ) : (
                          <Link href={item.href}>
                            <Icon className="size-4" />
                            <span>{item.title}</span>
                          </Link>
                        )
                      }
                    />
                  </motion.li>
                );
              })}
              <AnimatePresence>
                {user && user.onboardingStep !== "DONE" && (
                  <motion.li
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                  >
                    <SidebarMenuBadge className="rounded-lg bg-orange-500/10 text-[11px] font-medium tracking-wide text-orange-600">
                      <Link
                        href="/onboarding"
                        className="flex items-center gap-1.5"
                      >
                        <RotateCw className="size-3" /> finish onboarding
                      </Link>
                    </SidebarMenuBadge>
                  </motion.li>
                )}
              </AnimatePresence>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-4">
        {user ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200/70 bg-white p-3">
            <div className="flex min-w-0 items-center gap-2">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt="@user"
                  className="size-8 shrink-0 rounded-full border border-neutral-200"
                />
              ) : (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-sm font-semibold text-orange-600">
                  {user.username.slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="truncate text-sm text-neutral-700">
                {user.name ?? user.username}
              </span>
            </div>
            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-red-500 disabled:opacity-50"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <a
            href={githubLoginUrl}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
          >
            <GitBranch className="size-4" /> Sign in with GitHub
          </a>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
