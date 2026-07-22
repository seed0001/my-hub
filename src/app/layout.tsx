import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "my-hub",
  description: "Personal command center — projects, bookmarks, and an AI assistant.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
