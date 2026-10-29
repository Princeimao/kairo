"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import type { LucideIcon } from "lucide-react";
import {
  CircleCheck,
  CircleDot,
  GitBranch,
  MessagesSquare,
  LayoutDashboard,
  LogOut,
  Plus,
  RotateCw,
  Settings,
} from "lucide-react";
import { apiFetch, githubLoginUrl, type PublicUser } from "@/lib/api";
import type { GithubEventItem } from "@/lib/api";
import { useGithubEvents } from "@/lib/use-github-events";
import { useSessions } from "@/lib/use-sessions";
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
  { title: "Settings", href: "/settings", icon: Settings },
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
  const { sessions } = useSessions();
  const githubEvents = useGithubEvents();
  const currentConversation = pathname.startsWith("/agent/")
    ? pathname.slice("/agent/".length)
    : null;

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

        <SidebarGroup className="mt-2">
          <SidebarGroupLabel className="text-[11px] font-medium uppercase tracking-widest text-neutral-400">
            Sessions
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/agent" && currentConversation === null}
                  tooltip="New chat"
                  className="cursor-pointer text-xs font-medium text-orange-600 hover:text-orange-700 data-[active=true]:bg-orange-50"
                  render={
                    <Link href="/agent">
                      <Plus className="size-3.5 shrink-0" />
                      <span>New chat</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
              {sessions.slice(0, 6).map((session, i) => (
                <motion.li
                  key={session.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.04 * i, duration: 0.35 }}
                >
                  <SidebarMenuButton
                    isActive={false}
                    tooltip={session.title}
                    className="cursor-pointer text-xs font-medium text-neutral-700 hover:text-neutral-950"
                    render={
                      <span className="flex items-center gap-2">
                        <MessagesSquare className="size-3.5 shrink-0 text-neutral-400" />
                        <span className="truncate">{session.title}</span>
                      </span>
                    }
                  />
                  {session.conversations.length > 0 && (
                    <SidebarMenu className="ml-4 mt-0.5 border-l border-neutral-200/70 pl-2">
                      {session.conversations
                        .slice(-4)
                        .reverse()
                        .map((conversation) => {
                          const StateIcon =
                            conversation.lastRole === "USER"
                              ? CircleDot
                              : CircleCheck;
                          return (
                            <SidebarMenuItem key={conversation.id}>
                              <SidebarMenuButton
                                isActive={currentConversation === conversation.id}
                                tooltip={conversation.preview ?? "Conversation"}
                                className="cursor-pointer text-[11px] text-neutral-500 hover:text-neutral-950 data-[active=true]:bg-orange-50 data-[active=true]:text-orange-600"
                                render={
                                  <Link href={`/agent/${conversation.id}`}>
                                    <StateIcon className="size-3 shrink-0 text-neutral-300" />
                                    <span className="truncate">
                                      {conversation.preview ?? "Empty conversation"}
                                    </span>
                                  </Link>
                                }
                              />
                            </SidebarMenuItem>
                          );
                        })}
                    </SidebarMenu>
                  )}
                </motion.li>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {githubEvents.length > 0 && (
          <SidebarGroup className="mt-2">
            <SidebarGroupLabel className="text-[11px] font-medium uppercase tracking-widest text-neutral-400">
              GitHub activity
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {githubEvents.slice(0, 5).map((event, i) => (
                  <motion.li
                    key={event.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.04 * i, duration: 0.35 }}
                  >
                    <SidebarMenuButton
                      tooltip={eventTitle(event)}
                      className="cursor-pointer text-xs text-neutral-500 hover:text-orange-600"
                      render={
                        <Link href={`/agent?task=${encodeURIComponent(taskFromEvent(event))}`}>
                          <GitBranch className="size-3.5 shrink-0 text-neutral-300" />
                          <span className="truncate">{eventTitle(event)}</span>
                        </Link>
                      }
                    />
                  </motion.li>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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

function eventTitle(event: GithubEventItem): string {
  const kind = event.eventType === "issues" ? "Issue" : event.eventType === "push" ? "Push" : "PR";
  const action = event.action ? ` ${event.action}` : "";
  const where = event.number ? ` #${event.number}` : "";
  return `${kind}${action}${where} · ${event.title ?? event.repo ?? "GitHub"}`;
}

/** Prompt draft shown in the agent console for this activity item. */
export function taskFromEvent(event: GithubEventItem): string {
  const kind = event.eventType === "issues" ? "Issue" : event.eventType === "push" ? "Push" : "Pull request";
  const link =
    event.url ??
    (event.repo ? `https://github.com/${event.repo}${event.number ? `/issues/${event.number}` : ""}` : null);
  return `Work on GitHub ${kind}${event.number ? ` #${event.number}` : ""}${
    event.repo ? ` in ${event.repo}` : ""
  }${event.title ? ` — ${event.title}` : ""}${link ? `. Details: ${link}` : ""}. Read the surrounding code, fix it, and open a pull request.`;
}
