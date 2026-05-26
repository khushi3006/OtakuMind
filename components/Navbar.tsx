"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { LayoutDashboard, CheckCircle2, PlayCircle, LogOut, User, Menu, X } from 'lucide-react';

interface UserSession {
  id: number;
  email: string;
  name: string | null;
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Check if current page is an auth page
  const isAuthPage = pathname === '/login' || pathname === '/signup';

  useEffect(() => {
    // Auto-close menu when navigating
    setIsMenuOpen(false);
    
    // Check session user on mount/pathname change
    const checkSession = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          setUser(null);
        }
      } catch (err) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, [pathname]);

  // Auto-close mobile menu when screen size becomes desktop size (> 768px)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setIsMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        setUser(null);
        router.refresh();
        router.push('/login');
      }
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const links = [
    { href: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { href: '/airing-schedule', label: 'Airing Schedule', icon: <PlayCircle size={18} /> },
    { href: '/original-list', label: 'Original History', icon: <CheckCircle2 size={18} /> },
  ];

  // Helper to get user initials
  const getInitials = (name: string | null, email: string) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return email.slice(0, 2).toUpperCase();
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbar-inner">
          <Link href="/" className="nav-logo">
            <span className="logo-dot"></span> OtakuMind
          </Link>

          {!isAuthPage && !loading && user && (
            <>
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

              <div className="nav-user-menu" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div 
                  className="user-profile-badge" 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    background: '#fdfaf6',
                    padding: '0.4rem 0.8rem',
                    borderRadius: '20px',
                    border: '1px solid #eae8e1',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    color: 'var(--text-secondary)'
                  }}
                >
                  <span 
                    className="avatar-bubble" 
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: 'var(--accent-color)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                    }}
                  >
                    {getInitials(user.name, user.email)}
                  </span>
                  <span>{user.name || user.email.split('@')[0]}</span>
                </div>

                <button 
                  onClick={handleLogout}
                  className="btn-logout"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    color: 'var(--text-muted)',
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger-color)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                >
                  <LogOut size={16} />
                  <span>Sign Out</span>
                </button>
              </div>

              <button 
                className="mobile-nav-toggle"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                aria-label="Toggle navigation menu"
              >
                {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </>
          )}

          {isAuthPage && (
            <div className="nav-links">
              <Link 
                href={pathname === '/login' ? '/signup' : '/login'} 
                className="nav-item active"
                style={{ fontWeight: 600 }}
              >
                {pathname === '/login' ? 'Create Account' : 'Sign In'}
              </Link>
            </div>
          )}
        </div>
      </nav>

      {/* Mobile Drawer Dropdown Menu (rendered outside nav to avoid backdrop-filter constraints) */}
      {isMenuOpen && !isAuthPage && !loading && user && (
        <>
          <div className="mobile-menu-backdrop" onClick={() => setIsMenuOpen(false)} />
          
          <div className="navbar-mobile-menu">
            <div className="mobile-drawer-header">
              <div className="mobile-drawer-logo">
                <span className="logo-dot"></span> OtakuMind
              </div>
              <button 
                className="mobile-drawer-close"
                onClick={() => setIsMenuOpen(false)}
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mobile-profile-card">
              <span className="avatar-bubble-large">
                {getInitials(user.name, user.email)}
              </span>
              <div className="mobile-profile-info">
                <h4>{user.name || user.email.split('@')[0]}</h4>
                <p>{user.email}</p>
              </div>
            </div>

            <div className="nav-links-mobile">
              {links.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`nav-item-mobile ${isActive ? 'active' : ''}`}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {link.icon}
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="nav-user-menu-mobile">
              <button 
                onClick={() => {
                  setIsMenuOpen(false);
                  handleLogout();
                }}
                className="btn-logout-mobile"
              >
                <LogOut size={16} />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
