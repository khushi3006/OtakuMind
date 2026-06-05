"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Lock, Plus, Check, RefreshCw, Film, PlayCircle, XCircle, Settings, ChevronLeft, ChevronRight, ArrowLeft,
} from 'lucide-react';
import Modal from '@/components/Modal';
import Toast, { type ToastMessage } from '@/components/Toast';
import FollowButton from '@/components/FollowButton';
import UserCard, { type UserCardData } from '@/components/UserCard';

type Profile = {
  id: number;
  username: string;
  name: string | null;
  bio: string | null;
  isPublic: boolean;
  createdAt: string;
  followersCount: number;
  followingCount: number;
  isSelf: boolean;
  isFollowing: boolean;
  canViewList: boolean;
  animeCounts: { watching: number; completed: number; dropped: number; total: number };
};

type ListAnime = {
  id: number;
  name: string;
  normalizedName: string;
  season: number;
  episodesWatched: number;
  totalEpisodes: number;
  status: string;
  imageUrl: string | null;
  malId: number | null;
  type: string;
  airing: boolean;
  inMyList: boolean;
};

type TabKey = 'incomplete' | 'completed' | 'dropped';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'incomplete', label: 'Watching', icon: <PlayCircle size={16} /> },
  { key: 'completed', label: 'Completed', icon: <Check size={16} /> },
  { key: 'dropped', label: 'Dropped', icon: <XCircle size={16} /> },
];

function formatSeasonText(season: number, type: string): string {
  if (type === 'Movie') return 'Movie';
  if (type === 'OVA') return 'OVA';
  if (type === 'ONA') return 'ONA';
  if (type === 'Special') return 'Special';
  if (season === 99) return 'Final Season';
  return `Season ${season}`;
}

function initials(name: string | null, username: string) {
  if (name && name.trim()) {
    return name.trim().split(/\s+/).map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  }
  return username.slice(0, 2).toUpperCase();
}

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const username = String(params.username || '');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>('incomplete');
  const [animes, setAnimes] = useState<ListAnime[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [addingId, setAddingId] = useState<number | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Edit-profile modal (self only)
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editIsPublic, setEditIsPublic] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Followers / Following modal
  const [showConnections, setShowConnections] = useState<null | 'followers' | 'following'>(null);
  const [connections, setConnections] = useState<UserCardData[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);

  const listReqRef = useRef(0);

  const addToast = useCallback((message: string, type: 'success' | 'info' | 'warning' = 'info') => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}`);
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not load profile');
        setProfile(null);
        return;
      }
      setProfile(data.profile);
    } catch {
      setError('Could not load profile');
    } finally {
      setProfileLoading(false);
    }
  }, [username, router]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const loadList = useCallback(async (tab: TabKey, pageNum: number) => {
    if (!profile?.canViewList) return;
    const reqId = ++listReqRef.current;
    setListLoading(true);
    try {
      const res = await fetch(
        `/api/users/${encodeURIComponent(username)}/anime?status=${tab}&page=${pageNum}&limit=20`
      );
      const data = await res.json();
      if (reqId !== listReqRef.current) return;
      if (res.ok) {
        setAnimes(data.data || []);
        setTotalPages(data.pagination?.totalPages || 1);
      } else {
        setAnimes([]);
      }
    } catch {
      if (reqId === listReqRef.current) setAnimes([]);
    } finally {
      if (reqId === listReqRef.current) setListLoading(false);
    }
  }, [username, profile?.canViewList]);

  useEffect(() => {
    if (profile?.canViewList) loadList(activeTab, page);
  }, [profile?.canViewList, activeTab, page, loadList]);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setPage(1);
  };

  const handleAddToMyList = async (anime: ListAnime) => {
    if (addingId) return;
    setAddingId(anime.id);
    try {
      const res = await fetch('/api/anime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: anime.name,
          malId: anime.malId,
          imageUrl: anime.imageUrl,
          type: anime.type,
          totalEpisodes: anime.totalEpisodes,
          episodesWatched: 0,
          status: 'incomplete',
          airing: anime.airing,
        }),
      });

      if (res.status === 409) {
        addToast('Already in your list', 'warning');
        setAnimes((prev) => prev.map((a) => (a.id === anime.id ? { ...a, inMyList: true } : a)));
        return;
      }
      if (!res.ok) throw new Error('Add failed');

      addToast(`Added "${anime.name}" to your watching list`, 'success');
      setAnimes((prev) => prev.map((a) => (a.id === anime.id ? { ...a, inMyList: true } : a)));
    } catch {
      addToast('Failed to add anime', 'warning');
    } finally {
      setAddingId(null);
    }
  };

  const openEdit = () => {
    if (!profile) return;
    setEditName(profile.name || '');
    setEditUsername(profile.username);
    setEditBio(profile.bio || '');
    setEditIsPublic(profile.isPublic);
    setEditError(null);
    setShowEdit(true);
  };

  const saveEdit = async () => {
    if (!profile) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          username: editUsername.trim().toLowerCase(),
          bio: editBio,
          isPublic: editIsPublic,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || 'Failed to save');
        return;
      }
      addToast('Profile updated', 'success');
      setShowEdit(false);
      const newUsername = data.user.username;
      if (newUsername !== profile.username) {
        router.replace(`/users/${newUsername}`);
      } else {
        setProfile((prev) => prev && { ...prev, ...data.user });
      }
    } catch {
      setEditError('Failed to save');
    } finally {
      setSavingEdit(false);
    }
  };

  const openConnections = async (kind: 'followers' | 'following') => {
    setShowConnections(kind);
    setConnectionsLoading(true);
    setConnections([]);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}/${kind}`);
      const data = await res.json();
      setConnections(res.ok ? data.data || [] : []);
    } catch {
      setConnections([]);
    } finally {
      setConnectionsLoading(false);
    }
  };

  // ---- Render states ----
  if (profileLoading) {
    return (
      <main className="dashboard">
        <div className="profile-header-card skeleton-row" style={{ minHeight: '160px' }}>
          <span className="profile-avatar shimmer" style={{ color: 'transparent' }}>··</span>
          <div style={{ flex: 1 }}>
            <div className="skeleton-bar shimmer" style={{ width: '180px', height: '1.5rem', marginBottom: '0.6rem' }} />
            <div className="skeleton-bar shimmer" style={{ width: '120px', height: '1rem' }} />
          </div>
        </div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="dashboard">
        <div className="profile-empty">
          <p className="empty-state">{error || 'User not found'}</p>
          <button className="btn-link" onClick={() => router.push('/users')}>
            <ArrowLeft size={16} /> Back to Discover
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <button className="back-link" onClick={() => router.push('/users')}>
        <ArrowLeft size={16} /> Discover
      </button>

      <div className="profile-header-card animate-fade-in">
        <span className="profile-avatar">{initials(profile.name, profile.username)}</span>

        <div className="profile-meta">
          <div className="profile-name-row">
            <h1>{profile.name || profile.username}</h1>
            {!profile.isPublic && (
              <span className="profile-private-pill"><Lock size={12} /> Private</span>
            )}
          </div>
          <span className="profile-handle">@{profile.username}</span>
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}

          <div className="profile-stats">
            <button className="profile-stat" onClick={() => openConnections('followers')}>
              <strong>{profile.followersCount}</strong> Followers
            </button>
            <button className="profile-stat" onClick={() => openConnections('following')}>
              <strong>{profile.followingCount}</strong> Following
            </button>
            {profile.canViewList && (
              <span className="profile-stat static">
                <strong>{profile.animeCounts.total}</strong> Anime
              </span>
            )}
          </div>
        </div>

        <div className="profile-action">
          {profile.isSelf ? (
            <button className="btn-edit-profile" onClick={openEdit}>
              <Settings size={16} /> Edit Profile
            </button>
          ) : (
            <FollowButton
              username={profile.username}
              initialIsFollowing={profile.isFollowing}
              onChange={(isFollowing, followersCount) =>
                setProfile((prev) =>
                  prev && {
                    ...prev,
                    isFollowing,
                    followersCount: followersCount ?? prev.followersCount,
                  }
                )
              }
            />
          )}
        </div>
      </div>

      {!profile.canViewList ? (
        <div className="profile-locked animate-fade-in">
          <Lock size={40} color="#a3b18a" />
          <h3>This account is private</h3>
          <p>{profile.name || `@${profile.username}`} keeps their anime list private.</p>
        </div>
      ) : (
        <>
          <div className="tabs-row" style={{ marginTop: '1.5rem' }}>
            <div className="tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab-btn ${activeTab === t.key ? 'active' : ''}`}
                  onClick={() => handleTabChange(t.key)}
                >
                  {t.label}
                  <span className="tab-count">
                    {t.key === 'incomplete'
                      ? profile.animeCounts.watching
                      : t.key === 'completed'
                      ? profile.animeCounts.completed
                      : profile.animeCounts.dropped}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <section className="list-section animate-fade-in">
            {listLoading ? (
              <div className="anime-poster-grid">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="poster-card skeleton-row" style={{ animationDelay: `${i * 30}ms` }}>
                    <div className="poster-img shimmer" />
                    <div className="skeleton-bar shimmer" style={{ width: '80%', height: '0.9rem', margin: '0.6rem' }} />
                  </div>
                ))}
              </div>
            ) : animes.length === 0 ? (
              <p className="empty-state">Nothing here yet.</p>
            ) : (
              <div className="anime-poster-grid">
                {animes.map((a) => (
                  <div key={a.id} className="poster-card">
                    <div className="poster-img-wrap">
                      {a.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.imageUrl} alt={a.name} className="poster-img" loading="lazy" />
                      ) : (
                        <div className="poster-img poster-placeholder"><Film size={28} /></div>
                      )}
                      {!profile.isSelf && (
                        a.inMyList ? (
                          <span className="poster-owned"><Check size={14} /> In your list</span>
                        ) : (
                          <button
                            className="poster-add-btn"
                            onClick={() => handleAddToMyList(a)}
                            disabled={addingId === a.id}
                            title="Add to my list"
                          >
                            {addingId === a.id ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
                            Add
                          </button>
                        )
                      )}
                    </div>
                    <div className="poster-info">
                      <span className="poster-title" title={a.name}>{a.name}</span>
                      <span className="poster-meta">
                        {formatSeasonText(a.season, a.type)}
                        {a.type !== 'Movie' && a.totalEpisodes > 0 && (
                          <> &middot; {a.episodesWatched}/{a.totalEpisodes} ep</>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="pagination-controls">
                <button className="pagination-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft size={16} />
                </button>
                <span className="pagination-ellipsis">Page {page} of {totalPages}</span>
                <button className="pagination-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </section>
        </>
      )}

      <Toast messages={toasts} onRemove={removeToast} />

      {/* Edit profile modal */}
      <Modal isOpen={showEdit} onClose={() => { if (!savingEdit) setShowEdit(false); }} title="Edit Profile">
        <div className="edit-modal-inner">
          {editError && <div className="form-error">{editError}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="p-name">Display Name</label>
            <input id="p-name" type="text" className="form-input" value={editName}
              onChange={(e) => setEditName(e.target.value)} disabled={savingEdit} placeholder="Your name" maxLength={60} />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="p-username">Username</label>
            <input id="p-username" type="text" className="form-input" value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)} disabled={savingEdit} placeholder="username" maxLength={20} />
            <small className="form-hint">3-20 chars: lowercase letters, numbers, underscores. This is your public handle.</small>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="p-bio">Bio</label>
            <textarea id="p-bio" className="form-input" value={editBio} rows={3}
              onChange={(e) => setEditBio(e.target.value)} disabled={savingEdit} placeholder="A short bio..." maxLength={280} />
          </div>

          <label className="toggle-row">
            <input type="checkbox" checked={editIsPublic} onChange={(e) => setEditIsPublic(e.target.checked)} disabled={savingEdit} />
            <span><strong>Public profile</strong> — anyone can view your anime lists. When off, only you can.</span>
          </label>

          <div className="modal-actions">
            <button className="modal-btn secondary" onClick={() => setShowEdit(false)} disabled={savingEdit}>Cancel</button>
            <button className="modal-btn primary" onClick={saveEdit} disabled={savingEdit || !editUsername.trim()}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              {savingEdit ? <><RefreshCw size={16} className="spin" /> Saving...</> : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Followers / Following modal */}
      <Modal
        isOpen={showConnections !== null}
        onClose={() => setShowConnections(null)}
        title={showConnections === 'followers' ? 'Followers' : 'Following'}
      >
        {connectionsLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}><RefreshCw size={24} className="spin" /></div>
        ) : connections.length === 0 ? (
          <p className="empty-state">No one here yet.</p>
        ) : (
          <div className="user-card-list" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {connections.map((u) => (
              <UserCard key={u.id} user={u} />
            ))}
          </div>
        )}
      </Modal>
    </main>
  );
}
