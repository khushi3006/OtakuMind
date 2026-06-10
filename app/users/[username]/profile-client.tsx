"use client";

import { useState, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Lock, Plus, Check, RefreshCw, Film, PlayCircle, XCircle, Settings, ChevronLeft, ChevronRight, ArrowLeft,
  UserPlus, UserCheck, Loader2, MoreVertical, Flag, Ban,
} from 'lucide-react';
import Modal from '@/components/Modal';
import Toast, { type ToastMessage } from '@/components/Toast';
import UserCard from '@/components/UserCard';
import { ApiError } from '@/lib/api';
import { qk } from '@/lib/query/keys';
import {
  useProfile,
  useUserAnime,
  useFollow,
  useFollowers,
  useFollowing,
  useUpdateProfile,
  useBlock,
  useUnblock,
  useReport,
  type ListAnime,
  type ListAnimePage,
  type ReportReason,
} from '@/lib/query/hooks/users';
import { useCreateAnime } from '@/lib/query/hooks/anime';

type TabKey = 'incomplete' | 'completed' | 'dropped';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'incomplete', label: 'Watching', icon: <PlayCircle size={16} /> },
  { key: 'completed', label: 'Completed', icon: <Check size={16} /> },
  { key: 'dropped', label: 'Dropped', icon: <XCircle size={16} /> },
];

const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: 'spam', label: 'Spam' },
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'inappropriate', label: 'Inappropriate content' },
  { key: 'impersonation', label: 'Impersonation' },
  { key: 'other', label: 'Something else' },
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
  const queryClient = useQueryClient();
  const username = String(params.username || '');

  const [activeTab, setActiveTab] = useState<TabKey>('incomplete');
  const [page, setPage] = useState(1);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [followHovered, setFollowHovered] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Edit-profile modal (self only)
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editIsPublic, setEditIsPublic] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  // Followers / Following modal
  const [showConnections, setShowConnections] = useState<null | 'followers' | 'following'>(null);

  // Moderation (other users only): kebab menu, report modal, block confirm, post-block view.
  const [showActions, setShowActions] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const [reportDetails, setReportDetails] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockedLocally, setBlockedLocally] = useState(false);

  const addToast = useCallback((message: string, type: 'success' | 'info' | 'warning' = 'info') => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const profileQuery = useProfile(username);
  const profile = profileQuery.data ?? null;

  // Redirect to /login on an unauthorized profile fetch.
  useEffect(() => {
    const err = profileQuery.error;
    if (err instanceof ApiError && err.status === 401) {
      router.replace('/login');
    }
  }, [profileQuery.error, router]);

  const canViewList = !!profile?.canViewList;
  const listQuery = useUserAnime(username, activeTab, page, canViewList);
  const animes = listQuery.data?.data ?? [];
  const totalPages = listQuery.data?.pagination?.totalPages ?? 1;
  // Match the old behavior: skeleton shows while fetching the active page.
  const listLoading = canViewList && listQuery.isFetching && !listQuery.data;

  const followMutation = useFollow(username);
  const createMutation = useCreateAnime();
  const updateProfile = useUpdateProfile();
  const blockMutation = useBlock(username);
  const unblockMutation = useUnblock();
  const reportMutation = useReport(username);

  const followersQuery = useFollowers(username, showConnections === 'followers');
  const followingQuery = useFollowing(username, showConnections === 'following');
  const connections =
    (showConnections === 'followers' ? followersQuery.data : followingQuery.data) ?? [];
  const connectionsLoading =
    showConnections === 'followers'
      ? followersQuery.isLoading
      : showConnections === 'following'
      ? followingQuery.isLoading
      : false;

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setPage(1);
  };

  const toggleFollow = () => {
    if (!profile || followMutation.isPending) return;
    followMutation.mutate(profile.isFollowing ? 'unfollow' : 'follow');
  };

  const openReport = () => {
    setReportReason(null);
    setReportDetails('');
    setReportError(null);
    setShowReport(true);
  };

  const submitReport = () => {
    if (!reportReason || reportMutation.isPending) return;
    setReportError(null);
    reportMutation.mutate(
      { reason: reportReason, details: reportDetails.trim() || undefined },
      {
        onSuccess: () => {
          addToast('Report submitted. Thanks for letting us know.', 'success');
          setShowReport(false);
        },
        onError: (e) => setReportError(e instanceof ApiError ? e.message : 'Could not submit the report.'),
      },
    );
  };

  const submitBlock = () => {
    if (blockMutation.isPending) return;
    setBlockError(null);
    blockMutation.mutate(undefined, {
      onSuccess: () => {
        setShowBlockConfirm(false);
        setBlockedLocally(true);
      },
      onError: (e) => setBlockError(e instanceof ApiError ? e.message : 'Could not block. Please try again.'),
    });
  };

  const handleUnblock = () => {
    if (unblockMutation.isPending) return;
    unblockMutation.mutate(username, {
      onSuccess: () => {
        setBlockedLocally(false);
        profileQuery.refetch();
      },
      onError: () => addToast('Could not unblock. Please try again.', 'warning'),
    });
  };

  const handleAddToMyList = async (anime: ListAnime) => {
    if (addingId) return;
    setAddingId(anime.id);
    const markInList = () => {
      const key = qk.userAnime(username, activeTab, page);
      const prev = queryClient.getQueryData<ListAnimePage>(key);
      if (prev) {
        queryClient.setQueryData<ListAnimePage>(key, {
          ...prev,
          data: prev.data.map((a) => (a.id === anime.id ? { ...a, inMyList: true } : a)),
        });
      }
    };
    try {
      await createMutation.mutateAsync({
        name: anime.name,
        malId: anime.malId,
        imageUrl: anime.imageUrl,
        type: anime.type,
        totalEpisodes: anime.totalEpisodes,
        episodesWatched: 0,
        status: 'incomplete',
        airing: anime.airing,
      });
      addToast(`Added "${anime.name}" to your watching list`, 'success');
      markInList();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        addToast('Already in your list', 'warning');
        markInList();
      } else {
        addToast('Failed to add anime', 'warning');
      }
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
    setEditError(null);
    try {
      const data = await updateProfile.mutateAsync({
        name: editName,
        username: editUsername.trim().toLowerCase(),
        bio: editBio,
        isPublic: editIsPublic,
      });
      addToast('Profile updated', 'success');
      setShowEdit(false);
      const newUsername = data.user.username;
      if (newUsername !== profile.username) {
        router.replace(`/users/${newUsername}`);
      }
      // else: invalidation in the hook refetches the profile with the new values.
    } catch (e) {
      setEditError(e instanceof ApiError ? e.message : 'Failed to save');
    }
  };

  const savingEdit = updateProfile.isPending;

  // ---- Render states ----
  if (profileQuery.isLoading) {
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

  if (profileQuery.isError || !profile) {
    const message =
      profileQuery.error instanceof ApiError
        ? profileQuery.error.message
        : profileQuery.error
        ? 'Could not load profile'
        : 'User not found';
    return (
      <main className="dashboard">
        <div className="profile-empty">
          <p className="empty-state">{message}</p>
          <button className="btn-link" onClick={() => router.push('/users')}>
            <ArrowLeft size={16} /> Back to Discover
          </button>
        </div>
      </main>
    );
  }

  if (blockedLocally) {
    return (
      <main className="dashboard">
        <button className="back-link" onClick={() => router.push('/users')}>
          <ArrowLeft size={16} /> Discover
        </button>
        <div className="profile-locked animate-fade-in">
          <Ban size={40} color="#a3b18a" />
          <h3>You blocked @{profile.username}</h3>
          <p>They can&apos;t find your profile or follow you, and you won&apos;t see theirs.</p>
          <button className="btn-link" onClick={handleUnblock} disabled={unblockMutation.isPending}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.75rem' }}>
            {unblockMutation.isPending ? <Loader2 size={16} className="spin" /> : null} Unblock
          </button>
        </div>
        <Toast messages={toasts} onRemove={removeToast} />
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
            <button className="profile-stat" onClick={() => setShowConnections('followers')}>
              <strong>{profile.followersCount}</strong> Followers
            </button>
            <button className="profile-stat" onClick={() => setShowConnections('following')}>
              <strong>{profile.followingCount}</strong> Following
            </button>
            {profile.canViewList && (
              <span className="profile-stat static">
                <strong>{profile.animeCounts.total}</strong> Anime
              </span>
            )}
          </div>
        </div>

        <div className="profile-action" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {profile.isSelf ? (
            <button className="btn-edit-profile" onClick={openEdit}>
              <Settings size={16} /> Edit Profile
            </button>
          ) : (
            <>
              <button
                className={['follow-btn', profile.isFollowing ? 'following' : ''].filter(Boolean).join(' ')}
                onClick={toggleFollow}
                disabled={followMutation.isPending}
                onMouseEnter={() => setFollowHovered(true)}
                onMouseLeave={() => setFollowHovered(false)}
                aria-pressed={profile.isFollowing}
              >
                {followMutation.isPending ? (
                  <Loader2 size={16} className="spin" />
                ) : profile.isFollowing ? (
                  <>
                    <UserCheck size={16} />
                    <span>{followHovered ? 'Unfollow' : 'Following'}</span>
                  </>
                ) : (
                  <>
                    <UserPlus size={16} />
                    <span>Follow</span>
                  </>
                )}
              </button>

              <div style={{ position: 'relative' }}>
                <button
                  className="btn-icon-ghost"
                  onClick={() => setShowActions((v) => !v)}
                  aria-label="More options"
                  aria-haspopup="menu"
                  aria-expanded={showActions}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '40px', height: '40px', borderRadius: '50%',
                    border: '1px solid var(--border-color)', background: 'var(--bg-elevated, #fff)', cursor: 'pointer',
                  }}
                >
                  <MoreVertical size={18} />
                </button>
                {showActions && (
                  <>
                    <div onClick={() => setShowActions(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                    <div role="menu" style={{
                      position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 41,
                      minWidth: '180px', background: 'var(--bg-elevated, #fff)',
                      border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md, 10px)',
                      boxShadow: '0 12px 40px rgba(20,18,12,0.18)', overflow: 'hidden', padding: '0.25rem',
                    }}>
                      <button role="menuitem" className="dropdown-menu-item" style={{ width: '100%' }}
                        onClick={() => { setShowActions(false); openReport(); }}>
                        <Flag size={15} /> <span>Report</span>
                      </button>
                      <button role="menuitem" className="dropdown-menu-item danger-item" style={{ width: '100%' }}
                        onClick={() => { setShowActions(false); setBlockError(null); setShowBlockConfirm(true); }}>
                        <Ban size={15} /> <span>Block</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
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

      {/* Report modal */}
      <Modal
        isOpen={showReport}
        onClose={() => { if (!reportMutation.isPending) setShowReport(false); }}
        title="Report Account"
      >
        <div className="edit-modal-inner">
          {reportError && <div className="form-error">{reportError}</div>}
          <p style={{ margin: '0 0 0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
            Tell us what&apos;s wrong with <strong>@{profile.username}</strong>. Reports are confidential and reviewed by our team.
          </p>

          <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {REPORT_REASONS.map((r) => (
              <label key={r.key} className="toggle-row" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="report-reason"
                  checked={reportReason === r.key}
                  onChange={() => setReportReason(r.key)}
                  disabled={reportMutation.isPending}
                />
                <span>{r.label}</span>
              </label>
            ))}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="report-details">Add details (optional)</label>
            <textarea id="report-details" className="form-input" rows={3} value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)} disabled={reportMutation.isPending}
              placeholder="What happened?" maxLength={1000} />
          </div>

          <div className="modal-actions">
            <button className="modal-btn secondary" onClick={() => setShowReport(false)} disabled={reportMutation.isPending}>Cancel</button>
            <button className="modal-btn primary" onClick={submitReport} disabled={reportMutation.isPending || !reportReason}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              {reportMutation.isPending ? <><RefreshCw size={16} className="spin" /> Submitting...</> : 'Submit Report'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Block confirm modal */}
      <Modal
        isOpen={showBlockConfirm}
        onClose={() => { if (!blockMutation.isPending) setShowBlockConfirm(false); }}
        title="Block Account"
      >
        <div className="edit-modal-inner">
          {blockError && <div className="form-error">{blockError}</div>}
          <p style={{ margin: '0 0 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
            Block <strong>@{profile.username}</strong>? They won&apos;t be able to find your profile or follow you,
            and you won&apos;t see theirs. Any existing follows between you are removed. You can undo this from
            Blocked Accounts.
          </p>

          <div className="modal-actions">
            <button className="modal-btn secondary" onClick={() => setShowBlockConfirm(false)} disabled={blockMutation.isPending}>Cancel</button>
            <button className="modal-btn danger" onClick={submitBlock} disabled={blockMutation.isPending}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              {blockMutation.isPending ? <><RefreshCw size={16} className="spin" /> Blocking...</> : 'Block'}
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
