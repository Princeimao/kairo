"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  Check,
  CircleDot,
  FileSearch,
  Files,
  Globe,
  Layers3,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const useCases = [
  {
    id: "research",
    label: "Research",
    icon: Search,
    title: "Turn scattered information into useful insight.",
    description:
      "Investigate a topic, explore sources, compare alternatives, and organize findings into a result you can use.",
    capabilities: [
      "Explore a question from multiple angles",
      "Organize useful findings",
      "Build a report or structured summary",
    ],
    tasks: [
      { label: "Explore relevant sources", status: "Complete" },
      { label: "Compare key findings", status: "In progress" },
      { label: "Prepare a summary", status: "Next" },
    ],
  },
  {
    id: "browser",
    label: "Browser tasks",
    icon: Globe,
    title: "Take work beyond the chat window.",
    description:
      "Use browser-oriented workflows for tasks that require navigating information and moving through multiple steps.",
    capabilities: [
      "Work through browser-based tasks",
      "Collect information across pages",
      "Support repeatable multi-step workflows",
    ],
    tasks: [
      { label: "Open target pages", status: "Complete" },
      { label: "Gather required information", status: "In progress" },
      { label: "Organize the results", status: "Next" },
    ],
  },
  {
    id: "files",
    label: "Files & data",
    icon: Files,
    title: "Give your workflows room to work with files.",
    description:
      "Structure a task around documents, reference material, and the outputs that need to be produced.",
    capabilities: [
      "Work with task-related files",
      "Keep relevant context together",
      "Organize outputs for review",
    ],
    tasks: [
      { label: "Collect reference material", status: "Complete" },
      { label: "Process task inputs", status: "In progress" },
      { label: "Prepare deliverables", status: "Next" },
    ],
  },
  {
    id: "workflows",
    label: "Custom workflows",
    icon: Layers3,
    title: "Shape the process around your goal.",
    description:
      "Use skills and tools to define workflows that better fit the tasks you want your agent to handle.",
    capabilities: [
      "Extend agents with custom skills",
      "Combine steps into a workflow",
      "Refine the process around your needs",
    ],
    tasks: [
      { label: "Load the task instructions", status: "Complete" },
      { label: "Apply the workflow", status: "In progress" },
      { label: "Review the outcome", status: "Next" },
    ],
  },
];

export default function UseCasesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeCase, setActiveCase] = useState("research");

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const section = sectionRef.current;
    if (!section) return;

    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      gsap.fromTo(
        "[data-usecase-heading]",
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
        "[data-usecase-tabs]",
        { y: 35, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          delay: 0.15,
          ease: "power3.out",
          scrollTrigger: {
            trigger: "[data-usecase-tabs]",
            start: "top 85%",
            once: true,
          },
        },
      );
    }, section);

    return () => ctx.revert();
  }, []);

  useEffect(() => {
    const section = sectionRef.current;

    if (
      !section ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const panel = section.querySelector(`[data-case-panel="${activeCase}"]`);

    if (!panel) return;

    gsap.fromTo(
      panel.querySelectorAll("[data-case-reveal]"),
      { y: 14, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.45,
        stagger: 0.07,
        ease: "power2.out",
        overwrite: true,
      },
    );
  }, [activeCase]);

  return (
    <section
      ref={sectionRef}
      id="use-cases"
      className="border-t border-[#E9E2D9] bg-[#F6F4EF] px-5 py-24 sm:px-8 sm:py-32 lg:px-14 xl:px-20"
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <Badge
              data-usecase-heading
              variant="outline"
              className="mb-6 rounded-full border-orange-200 bg-orange-50 text-orange-700"
            >
              One workspace, many possibilities
            </Badge>

            <h2
              data-usecase-heading
              className="max-w-[850px] text-4xl font-semibold leading-[1.04] tracking-[-0.065em] sm:text-6xl"
            >
              What would you
              <br />
              <span className="text-orange-500">
                put your agent to work on?
              </span>
            </h2>
          </div>

          <p
            data-usecase-heading
            className="max-w-md text-base leading-7 text-[#77716A]"
          >
            Start with the kind of work you need done. Explore how an agent
            workspace can support different tasks and workflows.
          </p>
        </div>

        <div data-usecase-tabs className="mt-12">
          <Tabs value={activeCase} onValueChange={setActiveCase}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl border border-[#E5DED5] bg-white/80 p-1 sm:grid-cols-4">
              {useCases.map((item) => {
                const Icon = item.icon;

                return (
                  <TabsTrigger
                    key={item.id}
                    value={item.id}
                    className="gap-2 rounded-lg py-3 text-xs data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=active]:shadow-sm sm:text-sm"
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {useCases.map((item) => (
              <TabsContent
                key={item.id}
                value={item.id}
                data-case-panel={item.id}
                className="mt-6 focus-visible:outline-none"
              >
                <Card className="overflow-hidden rounded-2xl border-[#E5DED5] bg-[#FCFBF8] py-0 shadow-none">
                  <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
                    <CardContent className="flex flex-col justify-center p-6 sm:p-10 lg:p-12">
                      <div
                        data-case-reveal
                        className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600"
                      >
                        <item.icon className="h-6 w-6" />
                      </div>

                      <CardTitle
                        data-case-reveal
                        className="max-w-lg text-3xl leading-[1.08] tracking-[-0.05em] sm:text-4xl"
                      >
                        {item.title}
                      </CardTitle>

                      <CardDescription
                        data-case-reveal
                        className="mt-4 max-w-lg text-sm leading-7 text-[#77716A] sm:text-base"
                      >
                        {item.description}
                      </CardDescription>

                      <div className="mt-6 space-y-3">
                        {item.capabilities.map((capability) => (
                          <div
                            data-case-reveal
                            key={capability}
                            className="flex items-start gap-3 text-sm text-[#514C45]"
                          >
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                            {capability}
                          </div>
                        ))}
                      </div>

                      <Button
                        data-case-reveal

                        className="mt-8 w-fit rounded-xl bg-orange-500 hover:bg-orange-600"
                      >
                        <Link href="/signup">
                          Try Kairo
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    </CardContent>

                    {/* Illustrative workflow preview */}
                    <div className="relative flex min-h-[350px] items-center justify-center overflow-hidden border-t border-[#E5DED5] bg-[#F3F0E9] p-5 sm:p-10 lg:border-l lg:border-t-0">
                      <div className="absolute right-[-40px] top-[-60px] h-64 w-64 rounded-full bg-orange-200/40 blur-[70px]" />

                      <Card
                        data-case-reveal
                        className="relative w-full max-w-[460px] rounded-2xl border-[#E6DED5] bg-white shadow-[0_25px_70px_rgba(50,35,20,0.07)]"
                      >
                        <CardHeader className="border-b border-[#EEE9E2]">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 text-white">
                                <Sparkles className="h-5 w-5" />
                              </div>
                              <div>
                                <CardTitle className="text-sm">
                                  Task outline
                                </CardTitle>
                                <CardDescription className="mt-1 text-xs">
                                  Example workflow
                                </CardDescription>
                              </div>
                            </div>

                            <Badge
                              variant="outline"
                              className="rounded-full border-orange-200 bg-orange-50 text-[10px] text-orange-700"
                            >
                              Preview
                            </Badge>
                          </div>
                        </CardHeader>

                        <CardContent className="space-y-4 p-5">
                          {item.tasks.map((task, index) => (
                            <div
                              key={task.label}
                              className="flex items-center gap-3"
                            >
                              <div
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                  task.status === "Complete"
                                    ? "bg-green-50 text-green-600"
                                    : task.status === "In progress"
                                      ? "bg-orange-100 text-orange-600"
                                      : "bg-[#F1EEE8] text-[#91897E]"
                                }`}
                              >
                                {task.status === "Complete" ? (
                                  <Check className="h-4 w-4" />
                                ) : task.status === "In progress" ? (
                                  <CircleDot className="h-4 w-4" />
                                ) : (
                                  <span className="text-xs">{index + 1}</span>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-[#35312C]">
                                  {task.label}
                                </p>
                                <p className="mt-1 text-xs text-[#898176]">
                                  {task.status}
                                </p>
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>

                      <p className="absolute bottom-4 right-5 text-[10px] text-[#898176]">
                        Illustrative concept · Not a live session
                      </p>
                    </div>
                  </div>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </section>
  );
}
