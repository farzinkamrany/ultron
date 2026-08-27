import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ultron OS",
  description: "Global Peace Program",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
