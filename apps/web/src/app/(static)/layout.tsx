import StaticNavbar from "@/components/navbar/StaticNav";

export default function StaticLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <StaticNavbar brand="Hyperiux" loginHref="/login" signupHref="/signup" />
      <main>{children}</main>
    </>
  );
}
