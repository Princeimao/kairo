"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

const navigation = [
  { label: "Product", href: "#product" },
  { label: "Features", href: "#features" },
  { label: "Use cases", href: "#use-cases" },
  { label: "Pricing", href: "#pricing" },
  { label: "Docs", href: "/docs" },
];

const capabilities = [
  {
    number: "01",
    title: "Code autonomously",
    description: "Build features, fix bugs, and ship changes.",
  },
  {
    number: "02",
    title: "Run in the cloud",
    description: "Give every agent an isolated cloud workspace.",
  },
  {
    number: "03",
    title: "Work in parallel",
    description: "Delegate multiple tasks without blocking your workflow.",
  },
];

interface SaaSNavbarProps {
  brand?: string;
  loginHref?: string;
  signupHref?: string;
}

export default function StaticNavbar({
  brand = "Hyperiux",
  loginHref = "/login",
  signupHref = "/signup",
}: SaaSNavbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    const overlay = overlayRef.current;
    const content = contentRef.current;

    if (!overlay || !content) return;

    timelineRef.current?.kill();

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (isOpen) {
      document.body.style.overflow = "hidden";

      gsap.set(overlay, {
        display: "flex",
        pointerEvents: "auto",
      });

      if (reduceMotion) {
        gsap.set(overlay, { autoAlpha: 1 });
        gsap.set(content, { y: 0, opacity: 1 });
        return;
      }

      const tl = gsap.timeline();
      timelineRef.current = tl;

      tl.fromTo(
        overlay,
        { clipPath: "inset(0 0 100% 0)" },
        {
          clipPath: "inset(0 0 0% 0)",
          duration: 0.8,
          ease: "power4.inOut",
        },
      ).fromTo(
        content.children,
        { y: 28, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.55,
          stagger: 0.07,
          ease: "power3.out",
        },
        "-=0.35",
      );
    } else {
      document.body.style.overflow = "";

      if (reduceMotion) {
        gsap.set(overlay, {
          display: "none",
          pointerEvents: "none",
          autoAlpha: 0,
          clearProps: "clipPath",
        });
        gsap.set(content, { clearProps: "all" });
        return;
      }

      const tl = gsap.timeline({
        onComplete: () => {
          gsap.set(overlay, {
            display: "none",
            pointerEvents: "none",
            clearProps: "clipPath",
          });
          gsap.set(content.children, { clearProps: "all" });
        },
      });

      timelineRef.current = tl;

      tl.to(overlay, {
        clipPath: "inset(0 0 100% 0)",
        duration: 0.65,
        ease: "power4.inOut",
      });
    }

    return () => {
      timelineRef.current?.kill();
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      {/* Main SaaS header */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-black/5 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <a
            href="/"
            className="flex items-center gap-2.5"
            aria-label={`${brand} home`}
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-orange-500 text-white">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="size-5"
                aria-hidden="true"
              >
                <path
                  d="M5 16.5 12 4l7 12.5H5Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path
                  d="M9 16.5 12 11l3 5.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-tight text-neutral-950">
              {brand}
            </span>
          </a>

          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-8 lg:flex"
          >
            {navigation.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="text-sm font-medium text-neutral-600 transition-colors hover:text-orange-600"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <a
              href={loginHref}
              className="hidden px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:text-black sm:inline-flex"
            >
              Log in
            </a>

            <a
              href={signupHref}
              className="hidden items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-600 sm:inline-flex"
            >
              Start building
              <span aria-hidden="true">↗</span>
            </a>

            <button
              type="button"
              onClick={() => setIsOpen((value) => !value)}
              aria-label={isOpen ? "Close menu" : "Open menu"}
              aria-expanded={isOpen}
              aria-controls="saas-mobile-menu"
              className="flex size-10 flex-col items-center justify-center gap-1.5 rounded-xl border border-neutral-200 text-neutral-900 transition-colors hover:bg-neutral-100 lg:hidden"
            >
              <span
                className={`h-0.5 w-5 bg-current transition-transform duration-300 ${
                  isOpen ? "translate-y-1 rotate-45" : ""
                }`}
              />
              <span
                className={`h-0.5 w-5 bg-current transition-all duration-300 ${
                  isOpen ? "scale-x-0 opacity-0" : ""
                }`}
              />
              <span
                className={`h-0.5 w-5 bg-current transition-transform duration-300 ${
                  isOpen ? "-translate-y-2 -rotate-45" : ""
                }`}
              />
            </button>
          </div>
        </div>
      </header>

      {/* Animated full-screen menu */}
      <div
        ref={overlayRef}
        id="saas-mobile-menu"
        aria-hidden={!isOpen}
        className="fixed inset-0 z-40 hidden flex-col overflow-y-auto bg-[#ff5f00] pt-[76px] text-white"
        style={{
          clipPath: "inset(0 0 100% 0)",
          pointerEvents: isOpen ? "auto" : "none",
        }}
      >
        <div
          ref={contentRef}
          className="mx-auto flex min-h-full w-full max-w-7xl flex-1 flex-col justify-between gap-12 px-6 py-10 sm:px-10 lg:px-16"
        >
          <div className="flex items-center justify-between border-b border-white/25 pb-5">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-white/75">
              Your cloud workspace
            </span>
            <span className="flex items-center gap-2 text-xs text-white/80">
              <span className="size-2 rounded-full bg-green-300" />
              Built for autonomous work
            </span>
          </div>

          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <nav aria-label="Mobile navigation" className="flex flex-col">
              {navigation.map((item, index) => (
                <a
                  key={item.label}
                  href={item.href}
                  tabIndex={isOpen ? 0 : -1}
                  onClick={() => setIsOpen(false)}
                  className="group flex items-center justify-between border-b border-white/20 py-3 text-4xl font-medium tracking-tight transition-opacity hover:opacity-65 sm:text-5xl lg:text-6xl"
                >
                  <span>{item.label}</span>
                  <span className="text-xl transition-transform group-hover:-translate-y-1 group-hover:translate-x-1">
                    ↗
                  </span>
                </a>
              ))}

              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={loginHref}
                  tabIndex={isOpen ? 0 : -1}
                  onClick={() => setIsOpen(false)}
                  className="rounded-xl border border-white/40 px-5 py-3 font-medium transition-colors hover:bg-white/10"
                >
                  Log in
                </a>
                <a
                  href={signupHref}
                  tabIndex={isOpen ? 0 : -1}
                  onClick={() => setIsOpen(false)}
                  className="rounded-xl bg-white px-5 py-3 font-semibold text-neutral-950 transition-transform hover:scale-[1.02]"
                >
                  Start building <span aria-hidden="true">↗</span>
                </a>
              </div>
            </nav>

            {/* Product preview */}
            <div className="rounded-2xl border border-white/25 bg-black/10 p-5 sm:p-7">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-white/65">
                    Agent workspace
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">
                    From prompt to progress.
                  </h2>
                </div>
                <div className="rounded-lg border border-white/25 p-2 text-lg">
                  ↗
                </div>
              </div>

              <div className="rounded-xl bg-neutral-950 p-4 sm:p-5">
                <div className="mb-5 flex items-center gap-2 text-xs text-neutral-400">
                  <span className="size-2 rounded-full bg-green-400" />
                  Cloud agent / workspace-01
                </div>

                <p className="mb-4 text-sm leading-6 text-neutral-200">
                  "Build an authentication flow, add tests, and open a pull
                  request."
                </p>

                <div className="space-y-3 border-t border-white/10 pt-4">
                  {[
                    ["01", "Inspecting codebase", "Done"],
                    ["02", "Implementing changes", "Running"],
                    ["03", "Testing and review", "Queued"],
                  ].map(([number, title, status]) => (
                    <div
                      key={number}
                      className="flex items-center gap-3 text-sm"
                    >
                      <span className="text-neutral-500">{number}</span>
                      <span className="flex-1 text-neutral-200">{title}</span>
                      <span
                        className={
                          status === "Done"
                            ? "text-green-400"
                            : status === "Running"
                              ? "text-orange-300"
                              : "text-neutral-500"
                        }
                      >
                        {status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <p className="mt-4 text-sm leading-6 text-white/75">
                Delegate tasks to cloud agents, monitor execution, and keep your
                development workflow moving.
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-3 border-t border-white/25 pt-5 text-sm text-white/75 sm:flex-row">
            <span>{brand} — Your AI-powered cloud workforce.</span>
            <a
              href="/docs"
              tabIndex={isOpen ? 0 : -1}
              className="transition-colors hover:text-white"
            >
              Explore the documentation ↗
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
