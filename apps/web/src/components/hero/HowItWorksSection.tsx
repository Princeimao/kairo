"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowDown,
  ArrowRight,
  Check,
  CircleDot,
  ClipboardList,
  FileCheck2,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";

const steps = [
  {
    number: "01",
    icon: ClipboardList,
    title: "Start with the outcome",
    description:
      "Describe what needs to get done. Start with a goal, a question to investigate, or a workflow you want to complete.",
    detail: "Your goal sets the direction",
  },
  {
    number: "02",
    icon: Wrench,
    title: "Give the agent its tools",
    description:
      "Bring the right tools, skills, and context into the workflow so the agent has more than a conversation to work with.",
    detail: "Tools · Skills · Context",
  },
  {
    number: "03",
    icon: FileCheck2,
    title: "Move toward a result",
    description:
      "Let the workflow progress through its steps and produce useful outputs you can review and build on.",
    detail: "Work that moves forward",
  },
];

export default function HowItWorksSection() {
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
        "[data-work-heading]",
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

      gsap.fromTo(
        "[data-work-card]",
        { y: 55, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          stagger: 0.17,
          ease: "power3.out",
          scrollTrigger: {
            trigger: "[data-work-grid]",
            start: "top 82%",
            once: true,
          },
        },
      );

      gsap.fromTo(
        "[data-work-line]",
        { scaleX: 0 },
        {
          scaleX: 1,
          duration: 1.2,
          ease: "power2.inOut",
          scrollTrigger: {
            trigger: "[data-work-grid]",
            start: "top 78%",
            once: true,
          },
        },
      );
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      className="relative overflow-hidden border-t border-[#E9E2D9] bg-white px-5 py-24 sm:px-8 sm:py-32 lg:px-14 xl:px-20"
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="grid gap-7 lg:grid-cols-[1fr_0.65fr] lg:items-end lg:gap-16">
          <div>
            <Badge
              data-work-heading
              variant="outline"
              className="mb-6 rounded-full border-orange-200 bg-orange-50 text-orange-700"
            >
              A simple way to begin
            </Badge>

            <h2
              data-work-heading
              className="max-w-3xl text-4xl font-semibold leading-[1.02] tracking-[-0.065em] sm:text-6xl"
            >
              From an idea
              <br />
              <span className="text-orange-500">to actual work.</span>
            </h2>
          </div>

          <p
            data-work-heading
            className="max-w-[450px] text-base leading-7 text-[#77716A] sm:text-lg sm:leading-8"
          >
            Agentic work shouldn&apos;t stop at generating an answer. Give a
            task the context and capabilities it needs, then move toward a
            meaningful outcome.
          </p>
        </div>

        <div
          data-work-grid
          className="relative mt-14 grid gap-5 md:grid-cols-3"
        >
          <div
            data-work-line
            className="absolute left-[16%] right-[16%] top-[31px] hidden h-px origin-left bg-gradient-to-r from-orange-200 via-orange-500 to-orange-200 lg:block"
          />

          {steps.map((step) => {
            const Icon = step.icon;

            return (
              <Card
                key={step.number}
                data-work-card
                className="group relative rounded-2xl border-[#E8E1D8] bg-[#FAF9F6] shadow-none transition-all duration-300 hover:-translate-y-1 hover:border-orange-200 hover:shadow-[0_20px_55px_rgba(70,45,20,0.06)]"
              >
                <CardHeader className="pb-4">
                  <div className="relative z-10 flex items-center justify-between">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-200 bg-white text-orange-600 transition-all duration-300 group-hover:bg-orange-500 group-hover:text-white">
                      <Icon className="h-6 w-6" />
                    </div>
                    <span className="text-xs font-medium tracking-[0.16em] text-[#9A9288]">
                      {step.number}
                    </span>
                  </div>

                  <CardTitle className="pt-5 text-2xl tracking-[-0.04em]">
                    {step.title}
                  </CardTitle>

                  <CardDescription className="text-sm leading-6 text-[#77716A]">
                    {step.description}
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <div className="flex items-center gap-2 border-t border-[#E7E0D7] pt-4 text-xs font-medium text-[#716A61]">
                    <Check className="h-4 w-4 text-orange-600" />
                    {step.detail}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-[#E9E2D9] pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-lg text-sm leading-6 text-[#77716A]">
            The task can change. The tools can change. Your workspace should be
            flexible enough to support both.
          </p>

          <Button className="w-fit rounded-xl bg-orange-500 text-white hover:bg-orange-600">
            <Link href="/signup">
              Explore Kairo
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
