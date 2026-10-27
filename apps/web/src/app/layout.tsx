import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const sansFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

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
      <body
        className={`${sansFont.className} min-h-screen bg-white text-neutral-950 antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
