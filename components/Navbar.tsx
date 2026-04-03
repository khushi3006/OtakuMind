"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CheckCircle2, PlayCircle, Info } from 'lucide-react';

export default function Navbar() {
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { href: '/original-list', label: 'Original History', icon: <CheckCircle2 size={20} /> },
  ];

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link href="/" className="nav-logo">
          <span className="logo-dot"></span> OtakuMind
        </Link>
        <div className="nav-links">
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-item ${isActive ? 'active' : ''}`}
              >
                {link.icon}
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
