import { AppShell } from "@/components/kairo-app-shell";
import { SessionRefresh } from "@/components/session-refresh";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen w-full">
      <SessionRefresh />
      <AppShell>{children}</AppShell>
    </div>
  );
}
