import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "UniTrack",
  description: "University equipment borrowing and management system",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <Suspense
          fallback={<div className="h-[57px] border-b border-gray-200 bg-white" />}
        >
          <NavBar role="student" />
        </Suspense>
        <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}