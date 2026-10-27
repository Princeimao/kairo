"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowUpRight, CircleHelp } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const questions = [
  {
    question: "What is Kairo?",
    answer:
      "Kairo is being built as a workspace for agentic work. The goal is to bring agent capabilities, tools, custom skills, and task execution together so agents can do more than generate conversational responses.",
  },
  {
    question: "Is kairo only for coding agents?",
    answer:
      "No. The product direction is broader than coding. Potential workflows include research, browser-based tasks, working with files, organizing information, and other multi-step tasks supported by the tools and environment available to an agent.",
  },
  {
    question: "What are custom skills?",
    answer:
      "Custom skills are a way to extend the instructions and capabilities available to an agent for particular tasks or repeatable workflows. The exact formats and available integrations depend on what is implemented in the platform.",
  },
  {
    question: "Does an agent run in its own cloud environment?",
    answer:
      "kairo is designed around cloud-based agent execution. The exact isolation model, resource limits, and environment controls should be confirmed against the current product implementation and documentation.",
  },
  {
    question: "Can I use it for different kinds of workflows?",
    answer:
      "That is the goal. A workflow can start with a task and use the tools, skills, and resources that are appropriate for it. The tasks you can actually run will depend on the capabilities available in your workspace.",
  },
  {
    question: "Where can I learn about the platform?",
    answer:
      "Visit the documentation for the current implementation details and supported workflows. As the platform evolves, the documentation should remain the source of truth for available features.",
  },
];

export default function FAQSection() {
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
        "[data-faq-reveal]",
        { y: 26, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.75,
          stagger: 0.1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: section,
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
      id="faq"
      className="border-t border-[#E9E2D9] bg-white px-5 py-24 sm:px-8 sm:py-32 lg:px-14 xl:px-20"
    >
      <div className="mx-auto grid max-w-[1250px] gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
        <div>
          <Badge
            data-faq-reveal
            variant="outline"
            className="mb-6 rounded-full border-orange-200 bg-orange-50 text-orange-700"
          >
            <CircleHelp className="mr-1.5 h-3.5 w-3.5" />
            Questions, answered
          </Badge>

          <h2
            data-faq-reveal
            className="text-4xl font-semibold leading-[1.05] tracking-[-0.06em] sm:text-5xl"
          >
            A few things
            <br />
            you might
            <span className="text-orange-500"> wonder.</span>
          </h2>

          <p
            data-faq-reveal
            className="mt-5 max-w-sm text-base leading-7 text-[#77716A]"
          >
            Learn more about the idea behind Kario, the types of work it is
            designed for, and where to find implementation details.
          </p>

          <Button
            data-faq-reveal

            variant="outline"
            className="mt-7 rounded-xl border-[#DED7CE] bg-[#FAF9F6] hover:bg-orange-50"
          >
            <Link href="/docs">
              Read the docs
              <ArrowUpRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div data-faq-reveal>
          <Accordion type="single" collapsible className="w-full">
            {questions.map((item, index) => (
              <AccordionItem
                key={item.question}
                value={`question-${index}`}
                className="border-b border-[#E9E2D9] py-1"
              >
                <AccordionTrigger className="py-5 text-left text-base font-medium tracking-[-0.02em] hover:text-orange-600 hover:no-underline sm:text-lg">
                  {item.question}
                </AccordionTrigger>

                <AccordionContent className="max-w-2xl pb-6 text-sm leading-7 text-[#77716A] sm:text-base">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
