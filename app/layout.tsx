import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OtakuMind | Minimalist Anime Tracker",
  description: "An intelligent anime tracking system to log your watch history and calculate total unique anime with a clean, Japanese minimalist aesthetic.",
};

import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">

      <body className="antialiased">
        <Navbar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
