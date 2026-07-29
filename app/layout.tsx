import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Deskwise — AI SaaS Billing Support Agent",
  description:
    "Deskwise is a production-style RAG customer support agent for SaaS billing & subscription management, built with Next.js, Gemini 2.0 Flash, Qdrant Cloud, and Neon Postgres.",
  keywords: [
    "RAG",
    "retrieval-augmented generation",
    "AI customer support",
    "SaaS billing",
    "Gemini",
    "Qdrant",
    "Next.js",
    "vector search",
  ],
  authors: [{ name: "Deskwise" }],
  openGraph: {
    title: "Deskwise — AI SaaS Billing Support Agent",
    description:
      "Production-style RAG support agent with streaming, citations, confidence guardrails, and RAGAS-style evaluation.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-950">{children}</body>
    </html>
  );
}
