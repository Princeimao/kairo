"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  FileText,
  Globe2,
  Layers3,
  LockKeyhole,
  Puzzle,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Badge } from "../ui/badge";

const capabilities = [
  {
    number: "01",
    icon: Globe2,
    title: "Give agents the tools to act",
    description:
      "Move beyond text responses. Let agents interact with tools, explore the web, gather information, and work through multi-step tasks.",
    tags: ["Browser", "Tool use", "Research"],
    visual: "tools",
  },
  {
    number: "02",
    icon: Puzzle,
    title: "Make them your own",
    description:
      "Extend what an agent can do with custom skills and reusable workflows. Shape the environment around the work you want to accomplish.",
    tags: ["Custom skills", "Workflows", "Extensible"],
    visual: "skills",
  },
  {
    number: "03",
    icon: LockKeyhole,
    title: "Give work its own environment",
    description:
      "Run agent tasks in a dedicated cloud environment designed for execution, with room to work with files, tools, and task-specific resources.",
    tags: ["Isolated runtime", "Files", "Execution"],
    visual: "runtime",
  },
];

export default function CapabilitiesSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const section = sectionRef.current;
    if (!section) return;

    const ctx = gsap.context(() => {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      if (reduceMotion) return;

      gsap.fromTo(
        "[data-cap-heading]",
        { y: 45, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: {
            trigger: section,
            start: "top 76%",
            once: true,
          },
        },
      );

      gsap.fromTo(
        "[data-cap-card]",
        { y: 75, opacity: 0, rotateX: 5 },
        {
          y: 0,
          opacity: 1,
          rotateX: 0,
          duration: 0.85,
          stagger: 0.18,
          ease: "power3.out",
          scrollTrigger: {
            trigger: "[data-cap-grid]",
            start: "top 78%",
            once: true,
          },
        },
      );

      gsap.fromTo(
        "[data-cap-line]",
        { scaleX: 0 },
        {
          scaleX: 1,
          duration: 1.1,
          ease: "power3.inOut",
          scrollTrigger: {
            trigger: "[data-cap-grid]",
            start: "top 75%",
            once: true,
          },
        },
      );

      gsap.to("[data-cap-orbit]", {
        rotate: 360,
        duration: 28,
        repeat: -1,
        ease: "none",
        transformOrigin: "50% 50%",
      });

      gsap.to("[data-cap-spark]", {
        y: -7,
        duration: 1.8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        stagger: 0.35,
      });
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="capabilities"
      className="relative isolate overflow-hidden border-t border-[#E9E2D9] bg-[#F6F4EF] px-5 py-24 sm:px-8 sm:py-32 lg:px-14 xl:px-20"
    >
      {/* Background decoration */}
      <div className="pointer-events-none absolute right-[-150px] top-10 -z-10 h-[420px] w-[420px] rounded-full bg-orange-200/20 blur-[100px]" />

      <div
        data-cap-orbit
        className="pointer-events-none absolute right-[8%] top-[13%] -z-10 hidden h-40 w-40 rounded-full border border-dashed border-orange-300/40 lg:block"
      >
        <span className="absolute left-1/2 top-[-4px] h-2 w-2 rounded-full bg-orange-500" />
      </div>

      <div className="mx-auto max-w-[1440px]">
        {/* Section heading */}
        <div className="grid gap-8 lg:grid-cols-[1fr_0.65fr] lg:items-end lg:gap-16">
          <div>
            <div
              data-cap-heading
              className="mb-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-orange-600"
            >
              <span className="h-px w-8 bg-orange-500" />
              The Kairo foundation
            </div>

            <h2
              data-cap-heading
              className="max-w-[850px] text-4xl font-semibold leading-[1.02] tracking-[-0.065em] sm:text-6xl lg:text-7xl"
            >
              An agent needs more than a model.
              <span className="mt-1 block font-medium text-[#9A9389]">
                It needs a way to work.
              </span>
            </h2>
          </div>

          <div data-cap-heading className="lg:pb-2">
            <p className="max-w-[440px] text-base leading-7 text-[#756F67] sm:text-lg sm:leading-8">
              Intelligence is only one part of the equation. Kairo brings
              together the capabilities and execution environment agents need to
              turn instructions into outcomes.
            </p>

            <Link
              href="/docs"
              className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#25221E] transition-colors hover:text-orange-600"
            >
              Explore the platform
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Animated connector */}
        <div className="relative mt-14 hidden h-px origin-left bg-[#E4DCD2] lg:block">
          <div
            data-cap-line
            className="absolute inset-y-0 left-0 w-full origin-left bg-gradient-to-r from-orange-500 via-orange-300 to-transparent"
          />
        </div>

        {/* Capability cards */}
        <div
          data-cap-grid
          className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3"
        >
          {capabilities.map((capability) => {
            const Icon = capability.icon;

            return (
              <Card
                key={capability.number}
                data-cap-card
                className="group relative overflow-hidden rounded-2xl border-[#E6DFD6] bg-[#FCFBF8] shadow-none transition-all duration-500 hover:-translate-y-2 hover:border-orange-200 hover:shadow-[0_24px_70px_rgba(70,45,20,0.08)]"
              >
                <CardContent className="flex h-full flex-col p-6 sm:p-7">
                  {/* Card top */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium tracking-[0.14em] text-[#999187]">
                      / {capability.number}
                    </span>

                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-orange-100 bg-orange-50 text-orange-600 transition-all duration-500 group-hover:rotate-[-8deg] group-hover:scale-110 group-hover:bg-orange-500 group-hover:text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>

                  {/* Different visual for each capability */}
                  <div className="relative my-8 flex h-[150px] items-center justify-center overflow-hidden rounded-xl border border-[#EEE8E0] bg-[#F7F4EF]">
                    {capability.visual === "tools" && (
                      <div className="flex items-center gap-3">
                        <div
                          data-cap-spark
                          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-200 bg-white text-orange-600 shadow-sm"
                        >
                          <Globe2 className="h-6 w-6" />
                        </div>

                        <ArrowRight className="h-4 w-4 text-[#B3A99D]" />

                        <div
                          data-cap-spark
                          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#E5DDF5] bg-white text-[#8060B8] shadow-sm"
                        >
                          <Workflow className="h-6 w-6" />
                        </div>

                        <ArrowRight className="h-4 w-4 text-[#B3A99D]" />

                        <div
                          data-cap-spark
                          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-green-200 bg-white text-green-600 shadow-sm"
                        >
                          <Check className="h-6 w-6" />
                        </div>
                      </div>
                    )}

                    {capability.visual === "skills" && (
                      <div className="grid w-[225px] grid-cols-3 gap-2">
                        {[
                          { icon: Code2, label: "Code" },
                          { icon: FileText, label: "Files" },
                          { icon: Sparkles, label: "Custom" },
                        ].map((item, index) => {
                          const ItemIcon = item.icon;

                          return (
                            <div
                              key={item.label}
                              data-cap-spark
                              className={`flex flex-col items-center gap-3 rounded-xl border bg-white p-3 shadow-sm ${
                                index === 2
                                  ? "border-orange-200"
                                  : "border-[#E9E2D9]"
                              }`}
                            >
                              <ItemIcon
                                className={`h-5 w-5 ${
                                  index === 2
                                    ? "text-orange-600"
                                    : "text-[#77716A]"
                                }`}
                              />
                              <span className="text-[10px] text-[#77716A]">
                                {item.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {capability.visual === "runtime" && (
                      <div className="relative flex h-24 w-48 items-center justify-center">
                        <div className="absolute inset-x-3 top-0 h-16 rounded-xl border border-orange-200 bg-orange-100/60 transition-transform duration-500 group-hover:-translate-y-2" />

                        <div className="absolute inset-x-5 top-3 h-16 rounded-xl border border-[#DDD4C8] bg-white shadow-sm transition-transform duration-500 group-hover:translate-y-1" />

                        <div className="relative z-10 flex items-center gap-2 rounded-lg bg-[#292621] px-4 py-3 text-white">
                          <LockKeyhole className="h-4 w-4 text-orange-400" />
                          <span className="text-xs font-medium">
                            Isolated runtime
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card copy */}
                  <div className="flex flex-1 flex-col">
                    <h3 className="max-w-[300px] text-2xl font-semibold leading-tight tracking-[-0.045em]">
                      {capability.title}
                    </h3>

                    <p className="mt-3 flex-1 text-sm leading-6 text-[#77716A]">
                      {capability.description}
                    </p>

                    <div className="mt-6 flex flex-wrap gap-2 border-t border-[#ECE6DE] pt-5">
                      {capability.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="rounded-md bg-[#F1EEE8] px-2.5 py-1 text-[10px] font-medium text-[#6F685F] hover:bg-[#F1EEE8]"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="pointer-events-none absolute bottom-0 left-0 h-[2px] w-full origin-left scale-x-0 bg-orange-500 transition-transform duration-500 group-hover:scale-x-100" />
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Closing statement */}
        <div className="mt-16 flex flex-col gap-6 border-t border-[#E4DCD2] pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm leading-6 text-[#77716A]">
            One flexible foundation. Different agents, skills, and workflows
            built around the work that matters.
          </p>
        </div>
      </div>
    </section>
  );
}
