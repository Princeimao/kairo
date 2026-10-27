"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import gsap from "gsap";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bot,
  ChevronDown,
  Code2,
  FileSearch,
  Layers3,
  Menu,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";

const navigation = [
  { label: "Product", type: "dropdown" },
  { label: "Features", type: "dropdown" },
  { label: "Use cases", type: "dropdown" },
  { label: "Pricing", type: "link", href: "#pricing" },
  { label: "Docs", type: "link", href: "/docs" },
] as const;

const dropdowns = {
  Product: {
    eyebrow: "THE PLATFORM",
    title: "Your agent. Your environment.",
    description:
      "A cloud workspace for agents that can do more than write code.",
    items: [
      {
        icon: Bot,
        title: "Agent workspace",
        description: "A dedicated environment for every task.",
        href: "#product",
      },
      {
        icon: Layers3,
        title: "Custom skills",
        description: "Extend your agent with reusable capabilities.",
        href: "#skills",
      },
      {
        icon: ShieldCheck,
        title: "Isolated execution",
        description: "Run tasks in a separate environment.",
        href: "#security",
      },
      {
        icon: Workflow,
        title: "Task execution",
        description: "Let your agent work through complex tasks.",
        href: "#execution",
      },
    ],
  },

  Features: {
    eyebrow: "BUILT TO DO THE WORK",
    title: "Everything your agent needs.",
    description:
      "Give your agent the tools and environment to move from instructions to execution.",
    items: [
      {
        icon: Code2,
        title: "Coding & development",
        description: "Build, debug, and test projects.",
        href: "#coding",
      },
      {
        icon: FileSearch,
        title: "Research & browsing",
        description: "Explore information and organize findings.",
        href: "#research",
      },
      {
        icon: Layers3,
        title: "Files & skills",
        description: "Bring your own files and capabilities.",
        href: "#skills",
      },
      {
        icon: Workflow,
        title: "Parallel workflows",
        description: "Work on multiple tasks independently.",
        href: "#workflows",
      },
    ],
  },

  "Use cases": {
    eyebrow: "POSSIBILITIES",
    title: "Delegate the work, not just the code.",
    description:
      "From research to complex workflows, give your agent a goal and the tools to pursue it.",
    items: [
      {
        icon: FileSearch,
        title: "Deep research",
        description: "Gather, compare, and synthesize information.",
        href: "#research",
      },
      {
        icon: Code2,
        title: "Build applications",
        description: "Develop and iterate on real projects.",
        href: "#development",
      },
      {
        icon: Layers3,
        title: "Knowledge work",
        description: "Process documents, files, and data.",
        href: "#knowledge",
      },
      {
        icon: Workflow,
        title: "Custom automation",
        description: "Create workflows around your own needs.",
        href: "#automation",
      },
    ],
  },
} as const;

type MenuName = keyof typeof dropdowns;

interface SaaSNavbarProps {
  brand?: string;
  loginHref?: string;
  signupHref?: string;
}

export default function StaticNavbar({
  brand = "Kairo",
  loginHref = "/login",
  signupHref = "/signup",
}: SaaSNavbarProps) {
  const [activeMenu, setActiveMenu] = useState<MenuName | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const rootRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".nav-shell",
        { opacity: 0, y: -16 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: "power3.out",
          clearProps: "transform",
        },
      );

      gsap.fromTo(
        ".nav-brand, .nav-link, .nav-cta",
        { opacity: 0, y: 8 },
        {
          opacity: 1,
          y: 0,
          duration: 0.55,
          stagger: 0.055,
          delay: 0.12,
          ease: "power2.out",
        },
      );
    }, rootRef);

    return () => ctx.revert();
  }, []);

  // Animate the entire navbar container when opening or closing a dropdown.
  useEffect(() => {
    const panel = panelRef.current;
    const content = contentRef.current;

    if (!panel) return;

    timelineRef.current?.kill();

    const timeline = gsap.timeline();
    timelineRef.current = timeline;

    if (activeMenu) {
      panel.style.visibility = "visible";
      panel.style.pointerEvents = "auto";

      const isAlreadyOpen = Number(gsap.getProperty(panel, "height")) > 0;

      if (!isAlreadyOpen) {
        gsap.set(panel, {
          height: 0,
          opacity: 0,
        });

        timeline.to(panel, {
          height: "auto",
          opacity: 1,
          duration: 0.48,
          ease: "power3.inOut",
        });
      } else {
        timeline.to(panel, {
          height: "auto",
          opacity: 1,
          duration: 0.32,
          ease: "power2.out",
        });
      }

      if (content) {
        const items = content.querySelectorAll("[data-menu-item]");

        timeline.fromTo(
          items,
          {
            opacity: 0,
            y: 12,
            filter: "blur(3px)",
          },
          {
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
            duration: 0.38,
            stagger: 0.055,
            ease: "power3.out",
          },
          isAlreadyOpen ? 0 : 0.12,
        );
      }
    } else {
      panel.style.pointerEvents = "none";

      timeline.to(panel, {
        height: 0,
        opacity: 0,
        duration: 0.3,
        ease: "power3.inOut",
        onComplete: () => {
          panel.style.visibility = "hidden";
        },
      });
    }

    return () => {
      timeline.kill();
    };
  }, [activeMenu]);

  function toggleMenu(name: MenuName) {
    setActiveMenu((current) => (current === name ? null : name));
  }

  function closeAll() {
    setActiveMenu(null);
    setMobileOpen(false);
  }

  return (
    <header
      ref={rootRef}
      className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-6 sm:pt-5"
      onKeyDown={(event) => {
        if (event.key === "Escape") closeAll();
      }}
    >
      <div
        className="nav-shell relative mx-auto max-w-[1440px] bg-[#FCFBF9]/95 shadow-[0_8px_35px_rgba(30,20,45,0.045)] backdrop-blur-2xl rounded-2xl"
        onMouseLeave={() => setActiveMenu(null)}
      >
        {/* Main navigation row */}
        <div className="flex min-h-[70px] items-center px-4 sm:px-7">
          {/* Brand */}
          <Link
            href="/"
            onClick={closeAll}
            aria-label={`${brand} home`}
            className="nav-brand group flex shrink-0 items-center gap-2.5"
          >
            <span className="flex size-9 items-center justify-center overflow-hidden rounded-xl bg-orange-500 transition-transform duration-300 group-hover:rotate-[-5deg] group-hover:scale-105">
              <img
                src="/kairo_logo.jpg"
                alt="logo"
                className="size-full object-cover"
              />
            </span>

            <span className="text-[19px] font-semibold tracking-[-0.8px] text-neutral-900">
              {brand}
              <span className="text-orange-500">.</span>
            </span>
          </Link>

          {/* Navigation sits beside the logo, not in the center */}
          <nav
            aria-label="Main navigation"
            className="ml-5 hidden items-center gap-1 xl:ml-10 lg:flex"
          >
            {navigation.map((item, index) => {
              const isDropdown = item.type === "dropdown";
              const isActive = isDropdown && activeMenu === item.label;

              if (!isDropdown) {
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onMouseEnter={() => setActiveMenu(null)}
                    onFocus={() => setActiveMenu(null)}
                    className="nav-link group relative rounded-lg px-3 py-2.5 text-[13px] font-medium text-neutral-500 transition-colors duration-200 hover:bg-neutral-100/80 hover:text-neutral-950"
                  >
                    {item.label}
                    <span className="absolute inset-x-3 bottom-1 h-px origin-left scale-x-0 bg-orange-500 transition-transform duration-300 group-hover:scale-x-100" />
                  </Link>
                );
              }

              const name = item.label as MenuName;

              return (
                <button
                  key={item.label}
                  type="button"
                  aria-expanded={isActive}
                  onMouseEnter={() => setActiveMenu(name)}
                  onFocus={() => setActiveMenu(name)}
                  onClick={() => toggleMenu(name)}
                  style={{ "--nav-index": index } as React.CSSProperties}
                  className={`nav-link group relative flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors duration-200 ${
                    isActive
                      ? "bg-orange-50 text-orange-700"
                      : "text-neutral-500 hover:bg-neutral-100/80 hover:text-neutral-950"
                  }`}
                >
                  {item.label}

                  <ChevronDown
                    size={13}
                    className={`transition-transform duration-300 ${
                      isActive ? "rotate-180" : "group-hover:translate-y-0.5"
                    }`}
                  />

                  <span
                    className={`absolute inset-x-3 bottom-1 h-px origin-left bg-orange-500 transition-transform duration-300 ${
                      isActive ? "scale-x-100" : "scale-x-0"
                    }`}
                  />
                </button>
              );
            })}
          </nav>

          {/* CTA stays at the far right */}
          <div className="ml-auto hidden items-center gap-4 sm:flex">
            <Link
              href={loginHref}
              onMouseEnter={() => setActiveMenu(null)}
              className="nav-link text-[13px] font-medium text-neutral-500 transition-colors hover:text-neutral-950"
            >
              Log in
            </Link>

            <Link
              href={signupHref}
              className="nav-cta group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-neutral-950 px-[17px] py-[11px] text-[12px] font-medium text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-[0_6px_22px_rgba(234,88,12,0.2)]"
            >
              <span className="relative z-10">Start building</span>
              <ArrowUpRight
                size={14}
                className="relative z-10 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </Link>
          </div>

          {/* Mobile toggle */}
          <button
            type="button"
            onClick={() => {
              setMobileOpen((value) => !value);
              setActiveMenu(null);
            }}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            className="ml-auto flex size-10 items-center justify-center rounded-xl border border-neutral-200 text-neutral-800 transition-colors hover:bg-neutral-100 sm:ml-0 lg:hidden"
          >
            {mobileOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>

        {/* Expanding mega-menu: part of the navbar container */}
        <div
          ref={panelRef}
          aria-hidden={!activeMenu}
          inert={!activeMenu}
          className="invisible h-0 overflow-hidden border-t border-neutral-200/80 opacity-0"
        >
          {activeMenu && (
            <div
              ref={contentRef}
              className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[0.85fr_1.5fr] lg:gap-8 lg:p-8"
            >
              {/* Intro panel */}
              <div
                data-menu-item
                className="flex flex-col items-start justify-between gap-8 rounded-xl border border-orange-100 bg-gradient-to-br from-orange-50 via-[#F9F5F0] to-white p-5 sm:p-6"
              >
                <div>
                  <span className="mb-4 inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-orange-700">
                    <Sparkles size={13} />
                    {dropdowns[activeMenu].eyebrow}
                  </span>

                  <h2 className="max-w-xs text-[24px] font-medium leading-tight tracking-[-1px] text-neutral-900 sm:text-[27px]">
                    {dropdowns[activeMenu].title}
                  </h2>

                  <p className="mt-3 max-w-sm text-[13px] leading-6 text-neutral-500">
                    {dropdowns[activeMenu].description}
                  </p>
                </div>

                <Link
                  href="#product"
                  onClick={closeAll}
                  className="group inline-flex items-center gap-2 text-[12px] font-medium text-neutral-800 transition-colors hover:text-orange-600"
                >
                  Explore Kairo
                  <ArrowRight
                    size={14}
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  />
                </Link>
              </div>

              {/* Animated navigation items */}
              <div className="grid content-start gap-1 sm:grid-cols-2">
                {dropdowns[activeMenu].items.map((item) => {
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.title}
                      href={item.href}
                      data-menu-item
                      onClick={closeAll}
                      className="group flex gap-3 rounded-xl p-3 transition-colors duration-200 hover:bg-orange-50/80 sm:p-4"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200/80 bg-white text-neutral-600 shadow-sm transition-all duration-300 group-hover:border-orange-200 group-hover:bg-orange-100/70 group-hover:text-orange-700">
                        <Icon size={18} strokeWidth={1.7} />
                      </span>

                      <span className="min-w-0 pt-0.5">
                        <span className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-800">
                          {item.title}
                          <ArrowUpRight
                            size={12}
                            className="opacity-0 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-70"
                          />
                        </span>

                        <span className="mt-1 block text-[11px] leading-[1.8] text-neutral-500">
                          {item.description}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Mobile navigation */}
        <div
          className={`overflow-hidden border-t border-neutral-200/80 transition-[max-height,opacity] duration-300 ease-out lg:hidden ${
            mobileOpen
              ? "max-h-[75vh] overflow-y-auto opacity-100"
              : "max-h-0 border-t-0 opacity-0"
          }`}
        >
          <nav aria-label="Mobile navigation" className="space-y-1 p-3">
            {navigation.map((item) => {
              if (item.type === "link") {
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={closeAll}
                    className="block rounded-xl px-3 py-3 text-sm text-neutral-600 transition-colors hover:bg-orange-50 hover:text-orange-700"
                  >
                    {item.label}
                  </Link>
                );
              }

              const name = item.label as MenuName;
              const expanded = activeMenu === name;

              return (
                <div key={item.label}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleMenu(name)}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-sm text-neutral-600 transition-colors hover:bg-orange-50 hover:text-orange-700"
                  >
                    {item.label}
                    <ChevronDown
                      size={15}
                      className={`transition-transform duration-300 ${
                        expanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-300 ${
                      expanded
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="ml-3 space-y-1 border-l border-orange-200 py-1 pl-3">
                        {dropdowns[name].items.map((subItem) => (
                          <Link
                            key={subItem.title}
                            href={subItem.href}
                            onClick={closeAll}
                            className="block rounded-lg px-3 py-2.5 text-[13px] text-neutral-500 hover:bg-orange-50 hover:text-orange-700"
                          >
                            {subItem.title}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="grid grid-cols-2 gap-3 border-t border-neutral-200 pt-4">
              <Link
                href={loginHref}
                onClick={closeAll}
                className="rounded-xl border border-neutral-200 py-3 text-center text-sm text-neutral-700"
              >
                Log in
              </Link>

              <Link
                href={signupHref}
                onClick={closeAll}
                className="rounded-xl bg-neutral-950 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-orange-600"
              >
                Start building
              </Link>
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}
