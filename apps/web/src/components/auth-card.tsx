import { cn } from "@/lib/utils";

/** Centered card shell shared by the auth screens (orange/neutral palette). */
export function AuthCard({
  className,
  innerRef,
  children,
}: {
  className?: string;
  innerRef?: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-neutral-950 px-4 py-12">
      {/* orange glow + grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute left-1/2 top-[-12rem] h-[26rem] w-[42rem] -translate-x-1/2 rounded-full bg-orange-500/25 blur-[120px]" />
        <div className="absolute bottom-[-10rem] right-[-6rem] h-[18rem] w-[24rem] rounded-full bg-orange-400/10 blur-[110px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_65%_60%_at_50%_40%,#000_70%,transparent_100%)]" />
      </div>

      <div
        ref={innerRef}
        className={cn(
          "relative w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/70 p-8 text-center shadow-2xl backdrop-blur-xl",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}
