"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Users } from 'lucide-react';
import UserCard, { type UserCardData } from '@/components/UserCard';

export default function DiscoverPeople() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [users, setUsers] = useState<UserCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  // Redirect to login if not authenticated.
  useEffect(() => {
    fetch('/api/auth/me').then((res) => {
      if (!res.ok) router.replace('/login');
      else setAuthChecked(true);
    });
  }, [router]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const fetchUsers = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setUsers(res.ok ? data.data || [] : []);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authChecked) fetchUsers(debounced);
  }, [debounced, authChecked, fetchUsers]);

  return (
    <main className="dashboard">
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <h1>Discover People</h1>
            <p className="tagline">Find other otaku and explore their watchlists</p>
          </div>
        </div>
      </header>

      <div className="search-section animate-fade-in">
        <div className="search-wrapper">
          <Search className="search-icon" size={20} />
          <input
            type="text"
            placeholder="Search by username or name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="search-input"
            autoFocus
          />
        </div>
      </div>

      <section className="list-section animate-fade-in">
        <h2 className="section-title">
          <Users size={22} color="#a3b18a" />
          {debounced ? `Results for "${debounced}"` : 'Suggested People'}
        </h2>

        {loading ? (
          <div className="user-card-list">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="user-card skeleton-row" style={{ animationDelay: `${i * 40}ms` }}>
                <span className="user-card-avatar shimmer" style={{ color: 'transparent' }}>··</span>
                <div className="user-card-info">
                  <div className="skeleton-bar shimmer" style={{ width: '40%', height: '1rem', marginBottom: '0.4rem' }} />
                  <div className="skeleton-bar shimmer" style={{ width: '25%', height: '0.8rem' }} />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="empty-state">
            {debounced ? 'No users found. Try a different search.' : 'No other users yet.'}
          </p>
        ) : (
          <div className="user-card-list">
            {users.map((u) => (
              <UserCard key={u.id} user={u} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
