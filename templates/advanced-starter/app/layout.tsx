import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Advanced App",
  description: "Built with Open-Love",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
