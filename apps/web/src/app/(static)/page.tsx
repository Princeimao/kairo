"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import GhostFibers from "@/components/hero/Background";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import CapabilitiesSection from "@/components/hero/Capabilities";
import HowItWorksSection from "@/components/hero/HowItWorksSection";
import UseCasesSection from "@/components/hero/UseCasesSection";
import FAQSection from "@/components/hero/FAQSection";
import FinalCTASection from "@/components/hero/FinalCTASection";

export default function HomePage() {
  const heroRef = useRef<HTMLElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-hero-reveal]",
        { y: 28, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.85,
          stagger: 0.12,
          ease: "power3.out",
          delay: 0.15,
        },
      );

      gsap.fromTo(
        visualRef.current,
        { x: 36, opacity: 0, scale: 0.97 },
        {
          x: 0,
          opacity: 1,
          scale: 1,
          duration: 1.15,
          delay: 0.35,
          ease: "power3.out",
        },
      );

      gsap.to(visualRef.current, {
        y: -8,
        duration: 3.2,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        delay: 1.5,
      });
    }, heroRef);

    return () => ctx.revert();
  }, []);

  return (
    <>
      <main className="overflow-hidden bg-[#FAF8F4] text-[#211F1C]">
        <section
          ref={heroRef}
          className="relative isolate min-h-[calc(100svh-76px)]"
        >
          {/* React Bits background only */}
          <div className="pointer-events-none absolute inset-0 z-[-2] overflow-hidden">
            <GhostFibers
              glowColor="#F97316"
              layers={2}
              twist={0.8}
              threads={56}
              fiberStyle="dots"
              depthOfField={0.7}
              hoverEffect="focus"
              intro={true}
              mouseInteraction={true}
            />
          </div>

          {/* Soft brand-colored background treatment */}
          <div className="pointer-events-none absolute inset-0 z-[-1] bg-[#FAF8F4]/55" />
          <div className="pointer-events-none absolute inset-0 z-[-1] bg-[radial-gradient(ellipse_at_72%_48%,rgba(249,115,22,0.11),transparent_48%)]" />

          <div className="mx-auto grid min-h-[calc(100svh-76px)] max-w-[1600px] items-center gap-6 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[0.88fr_1.12fr] lg:gap-0 lg:px-12 xl:px-20">
            {/* LEFT: MESSAGE AND ACTIONS */}
            <div className="relative z-10 max-w-[690px] mt-10">
              <div data-hero-reveal>
                <Badge
                  variant="outline"
                  className="mb-7 gap-2 rounded-full border-orange-200 bg-orange-50/90 px-3.5 py-1.5 text-orange-500"
                >
                  Agentic workspace on cloud
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Badge>
              </div>

              <h1
                data-hero-reveal
                className="text-[clamp(2.3rem,5.3vw,5.3rem)] font-semibold leading-[0.91] tracking-[-0.050em]"
              >
                More than just
                <br />
                an agent.
                <br />
                <span className="text-orange-500">
                  A workspace
                  <br className="hidden sm:block" /> for real work.
                </span>
              </h1>

              <p
                data-hero-reveal
                className="mt-7 max-w-[540px] text-sm leading-7 text-[#746F68] sm:leading-8 tracking-tight"
              >
                Give your agents the tools, skills, and environment they need to
                research, browse, build, organize, and execute — all in one
                workspace designed for getting things done.
              </p>

              <div
                data-hero-reveal
                className="mt-8 flex flex-wrap items-center gap-3"
              >
                <Button
                  size="lg"
                  className="h-14 rounded-xl bg-orange-500 px-6 text-sm font-semibold text-white shadow-[0_6px_24px_rgba(249,115,22,0.2)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-orange-600"
                >
                  <Link
                    href="/signup"
                    className="flex items-center justify-center gap-2"
                  >
                    Getting Started
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>

                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 rounded-xl border-[#DDD7CE] bg-white/75 px-6 text-sm hover:border-orange-300 hover:bg-white"
                >
                  <Link href="/login" className="flex items-center gap-2">
                    Log in
                    <ArrowUpRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div
                data-hero-reveal
                className="mt-10 flex flex-wrap gap-x-6 gap-y-3 border-t border-[#E8E1D8] pt-5 text-xs text-[#746F68]"
              >
                <span className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-orange-600" />
                  Custom skills
                </span>
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-orange-600" />
                  Isolated environments
                </span>
                <span className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-orange-600" />
                  Flexible workflows
                </span>
              </div>
            </div>

            {/* RIGHT: GENERATED PRODUCT ILLUSTRATION */}
            <div
              ref={visualRef}
              className="relative mx-auto w-full max-w-[850px] opacity-0 lg:-ml-3 lg:max-w-none"
            >
              <div className="absolute inset-[12%] rounded-full bg-orange-300/20 blur-[90px]" />

              <div className="relative aspect-[1.2/1] w-full">
                <img
                  src="./hero.png"
                  alt="Illustration of an agent workspace with browser tools, custom skills, files, and an isolated execution environment"
                  sizes="(max-width: 1024px) 100vw, 58vw"
                  className="object-contain mix-blend-multiply"
                />
              </div>
            </div>
          </div>
        </section>
      </main>

      <CapabilitiesSection />
      <HowItWorksSection />

      <UseCasesSection />
      <FAQSection />
      <FinalCTASection />
    </>
  );
}
