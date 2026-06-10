import type { Metadata } from "next";

// Utility page: real users arrive via in-app links, so keep it out of search
// results (these used to be the only indexable pages on the site).
export const metadata: Metadata = {
  title: "Log In",
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
