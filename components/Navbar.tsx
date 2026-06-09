"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { LayoutDashboard, CheckCircle2, PlayCircle, LogOut, User, Menu, X, Lock, Loader2, Eye, EyeOff, Users, Trash2, Crown } from 'lucide-react';
import Logo from './Logo';
import Modal from './Modal';
import PaywallModal from './PaywallModal';
import { useEntitlement } from '@/lib/query/hooks/auth';
import { useQueryClient } from '@tanstack/react-query';

interface UserSession {
  id: number;
  email: string;
  name: string | null;
  username?: string | null;
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  // Custom Profile & Dropdown States
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  // Voluntary membership entry point (mirrors mobile's "Membership" settings row). Trial users
  // get the upgrade CTA; owners (purchased/grandfathered) get an "already a member" confirmation.
  // Expired users are behind the forced EntitlementGate, so they never need this row.
  const [isMembershipOpen, setIsMembershipOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: entitlement } = useEntitlement();
  const ownsLifetime =
    entitlement?.reason === 'purchased' || entitlement?.reason === 'grandfathered';
  const showMembership = ownsLifetime || entitlement?.reason === 'trial';

  // Delete Account States
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Change Password Form States
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Check if current page is an auth page
  const isAuthPage = pathname === '/login' || pathname === '/signup';

  useEffect(() => {
    // Auto-close menu/dropdown when navigating
    setIsMenuOpen(false);
    setIsDropdownOpen(false);
    
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



  // Handle outside clicks to close the profile dropdown on desktop
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('click', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [isDropdownOpen]);

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
        // Drop the signed-out user's cached queries so a later login in this tab
        // (possibly as someone else) starts from a clean cache.
        queryClient.clear();
        router.refresh();
        router.push('/login');
      }
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const closeDeleteModal = () => {
    if (isDeletingAccount) return;
    setIsDeleteModalOpen(false);
    setDeleteConfirmText('');
    setDeleteError('');
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    // Belt-and-suspenders: the submit button is disabled until this matches, but
    // guard here too so the destructive request can never fire without confirmation.
    if (deleteConfirmText !== 'DELETE') return;

    setDeleteError('');
    setIsDeletingAccount(true);
    try {
      const res = await fetch('/api/users/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error || 'Failed to delete account');
        setIsDeletingAccount(false);
        return;
      }
      // Account gone and cookie cleared server-side — drop local session and leave.
      setUser(null);
      router.refresh();
      router.push('/login');
    } catch (err) {
      setDeleteError('An unexpected error occurred');
      setIsDeletingAccount(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setErrorMessage('All fields are required');
      return;
    }

    if (newPassword.length < 6) {
      setErrorMessage('New password must be at least 6 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('New passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to change password');
      } else {
        setSuccessMessage('Password changed successfully!');
        // Clear input fields and reset visibility states
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setShowCurrentPassword(false);
        setShowNewPassword(false);
        setShowConfirmPassword(false);
        
        // Auto-close modal after success message completes
        setTimeout(() => {
          setIsPasswordModalOpen(false);
          setSuccessMessage('');
        }, 1800);
      }
    } catch (err) {
      setErrorMessage('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const links = [
    { href: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { href: '/airing-schedule', label: 'Airing Schedule', icon: <PlayCircle size={18} /> },
    { href: '/original-list', label: 'Original History', icon: <CheckCircle2 size={18} /> },
    { href: '/users', label: 'Discover', icon: <Users size={18} /> },
  ];

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
            <Logo size={24} /> OtakuMind
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

              {/* Desktop Profile Menu Dropdown */}
              <div className="nav-user-menu" style={{ display: 'flex', alignItems: 'center' }}>
                <div className="navbar-user-dropdown-container" ref={dropdownRef}>
                  <button 
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="user-profile-badge-btn"
                    aria-haspopup="true"
                    aria-expanded={isDropdownOpen}
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
                  </button>

                  <div className={`profile-dropdown-menu ${isDropdownOpen ? 'open' : ''}`}>
                    <div className="dropdown-user-header">
                      <span className="avatar-bubble-large">
                        {getInitials(user.name, user.email)}
                      </span>
                      <h4>{user.name || user.email.split('@')[0]}</h4>
                      <p>{user.email}</p>
                    </div>

                    <div className="dropdown-divider"></div>

                    {user.username && (
                      <Link
                        href={`/users/${user.username}`}
                        className="dropdown-menu-item"
                        onClick={() => setIsDropdownOpen(false)}
                      >
                        <User size={15} />
                        <span>My Profile</span>
                      </Link>
                    )}

                    <button
                      onClick={() => {
                        setIsDropdownOpen(false);
                        setIsPasswordModalOpen(true);
                      }}
                      className="dropdown-menu-item"
                    >
                      <Lock size={15} />
                      <span>Reset Password</span>
                    </button>

                    {showMembership && (
                      <button
                        onClick={() => {
                          setIsDropdownOpen(false);
                          setIsMembershipOpen(true);
                        }}
                        className="dropdown-menu-item"
                      >
                        <Crown size={15} />
                        <span>Membership</span>
                      </button>
                    )}

                    <button
                      onClick={() => {
                        setIsDropdownOpen(false);
                        setIsDeleteModalOpen(true);
                      }}
                      className="dropdown-menu-item danger-item"
                    >
                      <Trash2 size={15} />
                      <span>Delete Account</span>
                    </button>

                    <button
                      onClick={() => {
                        setIsDropdownOpen(false);
                        handleLogout();
                      }}
                      className="dropdown-menu-item danger-item"
                    >
                      <LogOut size={15} />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
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
                <Logo size={24} /> OtakuMind
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

            {/* Mobile Drawer Settings */}
            <div className="mobile-drawer-settings" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0 0.5rem' }}>
              {user.username && (
                <Link
                  href={`/users/${user.username}`}
                  className="dropdown-menu-item"
                  onClick={() => setIsMenuOpen(false)}
                  style={{ width: '100%', padding: '0.75rem 0.5rem', borderRadius: 'var(--radius-md)', background: 'var(--bg-color)' }}
                >
                  <User size={16} />
                  <span style={{ fontSize: '0.9rem' }}>My Profile</span>
                </Link>
              )}
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  setIsPasswordModalOpen(true);
                }}
                className="dropdown-menu-item"
                style={{ width: '100%', padding: '0.75rem 0.5rem', borderRadius: 'var(--radius-md)', background: 'var(--bg-color)' }}
              >
                <Lock size={16} />
                <span style={{ fontSize: '0.9rem' }}>Reset Password</span>
              </button>
              {showMembership && (
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsMembershipOpen(true);
                  }}
                  className="dropdown-menu-item"
                  style={{ width: '100%', padding: '0.75rem 0.5rem', borderRadius: 'var(--radius-md)', background: 'var(--bg-color)' }}
                >
                  <Crown size={16} />
                  <span style={{ fontSize: '0.9rem' }}>Membership</span>
                </button>
              )}
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  setIsDeleteModalOpen(true);
                }}
                className="dropdown-menu-item danger-item"
                style={{ width: '100%', padding: '0.75rem 0.5rem', borderRadius: 'var(--radius-md)', background: 'var(--bg-color)' }}
              >
                <Trash2 size={16} />
                <span style={{ fontSize: '0.9rem' }}>Delete Account</span>
              </button>
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

      {/* Voluntary membership modal — checkout for trial users, an "already a member"
          confirmation for owners. Same component as the forced gate, but dismissable. */}
      <PaywallModal
        isOpen={isMembershipOpen}
        onClose={() => setIsMembershipOpen(false)}
        owned={ownsLifetime}
        trialEndsAt={entitlement?.trialEndsAt ?? null}
      />

      {/* Change Password Modal */}
      <Modal
        isOpen={isPasswordModalOpen}
        onClose={() => {
          if (!isSubmitting) {
            setIsPasswordModalOpen(false);
            setErrorMessage('');
            setSuccessMessage('');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setShowCurrentPassword(false);
            setShowNewPassword(false);
            setShowConfirmPassword(false);
          }
        }}
        title="Change Password"
      >
        <form onSubmit={handlePasswordSubmit} className="change-password-form">
          {errorMessage && <div className="feedback-msg error">{errorMessage}</div>}
          {successMessage && <div className="feedback-msg success">{successMessage}</div>}

          <div className="form-group">
            <label htmlFor="currentPassword">Current Password</label>
            <div className="password-input-wrapper">
              <input
                type={showCurrentPassword ? "text" : "password"}
                id="currentPassword"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                disabled={isSubmitting}
                required
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                disabled={isSubmitting}
                title={showCurrentPassword ? "Hide current password" : "Show current password"}
                aria-label={showCurrentPassword ? "Hide current password" : "Show current password"}
              >
                {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="newPassword">New Password</label>
            <div className="password-input-wrapper">
              <input
                type={showNewPassword ? "text" : "password"}
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min. 6 chars)"
                disabled={isSubmitting}
                required
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowNewPassword(!showNewPassword)}
                disabled={isSubmitting}
                title={showNewPassword ? "Hide new password" : "Show new password"}
                aria-label={showNewPassword ? "Hide new password" : "Show new password"}
              >
                {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm New Password</label>
            <div className="password-input-wrapper">
              <input
                type={showConfirmPassword ? "text" : "password"}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                disabled={isSubmitting}
                required
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                disabled={isSubmitting}
                title={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="modal-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
            <button
              type="button"
              className="modal-btn secondary"
              onClick={() => {
                setIsPasswordModalOpen(false);
                setErrorMessage('');
                setSuccessMessage('');
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                setShowCurrentPassword(false);
                setShowNewPassword(false);
                setShowConfirmPassword(false);
              }}
              disabled={isSubmitting}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="modal-btn primary"
              disabled={isSubmitting}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Changing...</span>
                </>
              ) : (
                <span>Change Password</span>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Account Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={closeDeleteModal}
        title="Delete Account"
      >
        <form onSubmit={handleDeleteAccount} className="delete-account-form">
          {deleteError && <div className="feedback-msg error">{deleteError}</div>}

          <p style={{ margin: '0 0 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
            This permanently deletes your profile, anime list, and follows. This action
            cannot be undone.
          </p>

          <div className="form-group">
            <label htmlFor="deleteConfirm">
              Type <strong>DELETE</strong> to confirm
            </label>
            <input
              type="text"
              id="deleteConfirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={isDeletingAccount}
            />
          </div>

          <div className="modal-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
            <button
              type="button"
              className="modal-btn secondary"
              onClick={closeDeleteModal}
              disabled={isDeletingAccount}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="modal-btn danger"
              disabled={isDeletingAccount || deleteConfirmText !== 'DELETE'}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              {isDeletingAccount ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <span>Delete Account</span>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
