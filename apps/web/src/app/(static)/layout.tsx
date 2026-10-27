import StaticFooter from "@/components/footer/StaticFooter";
import StaticNavbar from "@/components/navbar/StaticNav";

export default function StaticLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <StaticNavbar brand="Kairo" />
      <main>{children}</main>
      <StaticFooter />
    </>
  );
}
