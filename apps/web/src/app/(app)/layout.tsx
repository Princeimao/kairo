import { AppShell } from "@/components/kairo-app-shell";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen w-full">
      <AppShell>{children}</AppShell>
    </div>
  );
}
