import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const footerGroups = [
  {
    title: "Platform",
    links: [
      { label: "Capabilities", href: "#capabilities" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Use cases", href: "#use-cases" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "FAQs", href: "#faq" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Log in", href: "/login" },
      { label: "Get started", href: "/signup" },
    ],
  },
];

export default function StaticFooter() {
  return (
    <footer className="border-t border-[#E9E2D9] bg-[#FAF9F6] px-5 pb-7 pt-14 sm:px-8 sm:pt-16 lg:px-14 xl:px-20">
      <div className="mx-auto max-w-[1440px]">
        <div className="grid gap-12 pb-12 md:grid-cols-[1.35fr_1fr] lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <Link
              href="/"

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
                Kairo
                <span className="text-orange-500">.</span>
              </span>
            </Link>

            <p className="mt-5 max-w-sm text-sm leading-7 text-[#77716A]">
              A workspace for agentic work. Bring tools, skills, and execution
              together to move tasks beyond conversation.
            </p>

            <Link
              href="/signup"
              className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#302B25] transition-colors hover:text-orange-600"
            >
              Start building
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Footer navigation */}
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h3 className="mb-5 text-xs font-semibold uppercase tracking-[0.16em] text-[#797168]">
                {group.title}
              </h3>

              <ul className="space-y-3.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-[#555048] transition-colors hover:text-orange-600"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Separator className="bg-[#E7E0D7]" />

        <div className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-[#898176]">
            © {new Date().getFullYear()} Kario. All rights reserved.
          </p>

          <div className="flex items-center gap-5">
            <Link
              href="/privacy"
              className="text-xs text-[#898176] transition-colors hover:text-orange-600"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-xs text-[#898176] transition-colors hover:text-orange-600"
            >
              Terms
            </Link>
            <Link
              href="/docs"
              aria-label="Kario documentation"
              className="inline-flex items-center gap-1.5 text-xs text-[#898176] transition-colors hover:text-orange-600"
            >
              Docs
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
