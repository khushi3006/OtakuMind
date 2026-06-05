import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <p className="site-footer-copy">© {year} OtakuMind</p>
      <nav className="site-footer-nav">
        <Link href="/privacy" className="site-footer-link">
          Privacy Policy
        </Link>
      </nav>
    </footer>
  );
}
