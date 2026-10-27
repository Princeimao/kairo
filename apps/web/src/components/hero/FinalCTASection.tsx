"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { ArrowUpRight, MoveUpRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function FinalCTASection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const section = sectionRef.current;
    if (!section) return;

    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      gsap.fromTo(
        "[data-cta-reveal]",
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: {
            trigger: section,
            start: "top 78%",
            once: true,
          },
        },
      );

      gsap.to("[data-cta-orbit]", {
        rotate: 360,
        duration: 35,
        repeat: -1,
        ease: "none",
        transformOrigin: "50% 50%",
      });

      gsap.to("[data-cta-spark]", {
        y: -8,
        duration: 2,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="get-started"
      className="relative isolate overflow-hidden border-t border-orange-200 bg-[#F9F3EA] px-5 py-24 sm:px-8 sm:py-32 lg:px-14 xl:px-20"
    >
      <div className="pointer-events-none absolute -right-24 -top-24 -z-10 h-[420px] w-[420px] rounded-full bg-orange-300/25 blur-[100px]" />

      <div
        data-cta-orbit
        className="pointer-events-none absolute -right-12 top-1/2 -z-10 hidden h-[370px] w-[370px] -translate-y-1/2 rounded-full border border-dashed border-orange-300/60 lg:block"
      >
        <div className="absolute left-1/2 top-0 h-3 w-3 rounded-full bg-orange-500" />
        <div className="absolute bottom-[17%] left-[8%] h-2 w-2 rounded-full bg-orange-400" />
      </div>

      <div className="mx-auto grid max-w-[1440px] gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="max-w-4xl">
          <Badge
            data-cta-reveal
            variant="outline"
            className="mb-7 rounded-full border-orange-200 bg-white/70 text-orange-700"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Make room for more capable agents
          </Badge>

          <h2
            data-cta-reveal
            className="text-4xl font-semibold leading-[1.02] tracking-[-0.065em] sm:text-6xl lg:text-7xl"
          >
            Give your ideas
            <br />
            <span className="text-orange-500">a way forward.</span>
          </h2>

          <p
            data-cta-reveal
            className="mt-6 max-w-2xl text-base leading-7 text-[#756E65] sm:text-lg sm:leading-8"
          >
            Start exploring a different way to work with agents — one built
            around tools, skills, workflows, and getting things done.
          </p>
        </div>

        <div
          data-cta-reveal
          className="flex flex-col items-start gap-4 lg:items-end"
        >
          <div
            data-cta-spark
            className="mb-1 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-[0_12px_35px_rgba(249,115,22,0.22)]"
          >
            <MoveUpRight className="h-7 w-7" />
          </div>

          <Button
            size="lg"
            className="h-12 rounded-xl bg-orange-500 px-6 font-semibold text-white hover:bg-orange-600"
          >
            <Link href="/signup">
              Get started with Kario
              <ArrowUpRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>

          <Link
            href="/login"
            className="text-sm text-[#716A61] transition-colors hover:text-orange-600"
          >
            Already have an account? Log in
          </Link>
        </div>
      </div>
    </section>
  );
}
