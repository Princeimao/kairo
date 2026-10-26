import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kairo – AI Coding Agent",
  description:
    "Cloud-hosted coding agent that fixes your GitHub issues and PRs automatically.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-950 antialiased">
        {children}
      </body>
    </html>
  );
}
