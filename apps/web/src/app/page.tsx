import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="inline-flex items-center rounded-full border border-border/60 bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500" />
            Now in early access
          </div>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Your AI coding agent
            <br />
            <span className="bg-gradient-to-r from-neutral-300 to-neutral-500 bg-clip-text text-transparent">
              that ships for you
            </span>
          </h1>

          <p className="mx-auto max-w-md text-base text-muted-foreground sm:text-lg">
            Point Kairo at a GitHub issue. It reads the codebase, writes the
            fix, opens the PR, and responds to reviews — while you sleep.
          </p>

          <div className="flex items-center justify-center gap-3 pt-2">
            <Link href="/login">
              <Button size="lg">Get started</Button>
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="lg">
                View on GitHub
              </Button>
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
