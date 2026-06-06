"use client";

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  PlayCircle,
  Calendar,
  RefreshCw,
  Plus,
  Minus,
  Check,
  Clock,
  AlertCircle,
  ChevronRight,
  Compass,
  Tv,
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { calculateAiringCountdown, countdownFromAiringAt, getLocalBroadcastDay, getISTBroadcastDetails, getISTDate } from '@/lib/airing-utils';
import Toast, { type ToastMessage } from '@/components/Toast';
import { isWakingUpError } from '@/lib/api';
import { useIncompleteAll, useUpdateAnime, useCreateAnime, type Anime } from '@/lib/query/hooks/anime';
import { usePopularAiring, type PopularAnime } from '@/lib/query/hooks/airing';

type TabKey = 'today' | 'week' | 'upcoming' | 'popular';

export default function AiringSchedulePage() {
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('today');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const trackedQuery = useIncompleteAll();
  const popularQuery = usePopularAiring();
  const updateAnime = useUpdateAnime();
  const createAnime = useCreateAnime();

  const trackedAnime = useMemo<Anime[]>(() => trackedQuery.data ?? [], [trackedQuery.data]);

  // Deduplicate popular shows by mal_id so cards render uniquely (preserved from original).
  const popularAiring = useMemo<PopularAnime[]>(() => {
    const data = popularQuery.data ?? [];
    const seen = new Set<number>();
    return data.filter((show) => {
      if (!show.mal_id || seen.has(show.mal_id)) return false;
      seen.add(show.mal_id);
      return true;
    });
  }, [popularQuery.data]);

  // The tracked list is still loading (cold-start retries are handled by the
  // shared QueryClient). isWakingUp drives the "database waking up" notice.
  const loadingTracked = trackedQuery.isPending;
  const isWakingUp = (trackedQuery.isPending || trackedQuery.isFetching) && isWakingUpError(trackedQuery.error);
  const loadingPopular = popularQuery.isPending;

  const currentLocalDay = (() => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[getISTDate().getUTCDay()];
  })();

  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const addToast = useCallback((
    message: string,
    type: 'success' | 'info' | 'warning' = 'info',
    duration?: number
  ) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Surface a one-time warning if the popular feed fails (matches original toast).
  useEffect(() => {
    if (popularQuery.isError) {
      addToast("Could not load popular seasonal recommendations", "warning");
    }
  }, [popularQuery.isError, addToast]);

  const handleUpdateEpisode = (id: number, currentCount: number, change: number) => {
    const newCount = Math.max(0, currentCount + change);
    // useUpdateAnime optimistically patches the cached incomplete list (status
    // unchanged), so the count updates instantly; it rolls back on error.
    updateAnime.mutate(
      { id, episodesWatched: newCount },
      {
        onError: () => addToast("Failed to update progress on database", "warning"),
      }
    );
  };

  const handleAddPopularShow = async (show: PopularAnime) => {
    if (isAdding) return;
    setIsAdding(String(show.mal_id));

    const newAnime = {
      name: show.title_english || show.title,
      episodesWatched: 0,
      status: 'incomplete',
      imageUrl: show.images?.jpg?.image_url || null,
      malId: show.mal_id,
      airing: show.airing || false,
      broadcastDay: show.broadcast?.day || null,
      broadcastTime: show.broadcast?.time || null,
      broadcastTimezone: show.broadcast?.timezone || null,
      broadcastString: show.broadcast?.string || null,
      type: show.type,
      totalEpisodes: show.episodes || 0,
      airingStart: show.aired?.from || null,
    };

    try {
      await createAnime.mutateAsync(newAnime);
      addToast(`Added "${newAnime.name}" to Currently Watching!`, "success");
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      if (status === 409) {
        addToast(`"${newAnime.name}" is already in your watchlist.`, "info");
      } else {
        console.error(e);
        addToast("Failed to add anime to watchlist", "warning");
      }
    } finally {
      setIsAdding(null);
    }
  };

  // Filter shows currently airing
  const airingTrackedShows = trackedAnime.filter(anime => anime.airing);

  // Grouped datasets
  const todayShows = airingTrackedShows.filter(anime => {
    const localDay = getLocalBroadcastDay(anime.broadcastDay ?? null, anime.broadcastTime ?? null);
    return localDay === currentLocalDay;
  });

  const upcomingShows = airingTrackedShows
    .map(anime => {
      const countdown = calculateAiringCountdown(anime.broadcastDay ?? null, anime.broadcastTime ?? null);
      return { anime, countdown };
    })
    .filter(item => item.countdown !== null)
    .sort((a, b) => (a.countdown?.diffMs || 0) - (b.countdown?.diffMs || 0));

  const renderAiringCard = (anime: Anime) => {
    const countdown = countdownFromAiringAt(anime.nextEpisodeAt) ?? calculateAiringCountdown(anime.broadcastDay ?? null, anime.broadcastTime ?? null);
    const istDetails = getISTBroadcastDetails(anime.broadcastDay ?? null, anime.broadcastTime ?? null);

    const badgeLabel = anime.nextEpisode ? `Ep ${anime.nextEpisode} ${countdown?.label}` : `Next episode ${countdown?.label}`;

    return (
      <div key={anime.id} className="airing-anime-card animate-fade-in">
        <div className="card-image-wrapper">
          {anime.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={anime.imageUrl} alt={anime.name} className="card-image" />
          ) : (
            <div className="card-image-placeholder">📺</div>
          )}
          {countdown && (
            <div className={`countdown-badge-overlay ${countdown.isAiringNow ? 'airing-now' : countdown.isToday ? 'airing-today' : ''}`}>
              {countdown.isAiringNow ? (
                <span className="live-indicator"><span className="ping-dot"></span>LIVE Now</span>
              ) : (
                badgeLabel
              )}
            </div>
          )}
        </div>

        <div className="card-body">
          <h4 className="card-title" title={anime.name}>{anime.name}</h4>

          <div className="card-schedule-info">
            <div className="info-row">
              <Clock size={12} className="meta-icon" />
              <span>Airs {istDetails ? istDetails.day : 'N/A'} at {istDetails ? istDetails.time : 'N/A'} (IST)</span>
            </div>
            {anime.broadcastString && (
              <p className="meta-broadcast-string">{anime.broadcastString}</p>
            )}
          </div>

          <div className="card-progress-bar">
            <div className="progress-details">
              <span>Watched Progress</span>
              <span className="progress-value">{anime.episodesWatched} episodes</span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, (anime.episodesWatched / 12) * 100)}%` }}
              ></div>
            </div>
          </div>

          <div className="card-controls">
            <button
              onClick={() => handleUpdateEpisode(anime.id, anime.episodesWatched, -1)}
              className="control-btn"
              disabled={anime.episodesWatched === 0}
              title="Decrement episodes"
            >
              <Minus size={14} />
            </button>
            <span className="control-count">{anime.episodesWatched}</span>
            <button
              onClick={() => handleUpdateEpisode(anime.id, anime.episodesWatched, 1)}
              className="control-btn increment"
              title="Increment episodes"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderPopularCard = (show: PopularAnime) => {
    const isAlreadyTracked = trackedAnime.some(anime => anime.malId === show.mal_id);
    const broadcastDay = show.broadcast?.day || null;
    const broadcastTime = show.broadcast?.time || null;
    const countdown = countdownFromAiringAt(show.nextEpisodeAt) ?? calculateAiringCountdown(broadcastDay, broadcastTime);
    const istDetails = getISTBroadcastDetails(broadcastDay, broadcastTime);

    const badgeLabel = show.nextEpisode ? `Ep ${show.nextEpisode} ${countdown?.label}` : `Next episode ${countdown?.label}`;

    return (
      <div key={show.mal_id} className="airing-anime-card discover animate-fade-in">
        <div className="card-image-wrapper">
          {show.images?.jpg?.image_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={show.images.jpg.image_url} alt={show.title} className="card-image" />
          ) : (
            <div className="card-image-placeholder">📺</div>
          )}
          {countdown && (
            <div className={`countdown-badge-overlay ${countdown.isAiringNow ? 'airing-now' : countdown.isToday ? 'airing-today' : ''}`}>
              {countdown.isAiringNow ? (
                <span className="live-indicator"><span className="ping-dot"></span>LIVE Now</span>
              ) : (
                badgeLabel
              )}
            </div>
          )}
          {show.score && (
            <span className="card-score-badge">⭐ {show.score}</span>
          )}
        </div>

        <div className="card-body">
          <h4 className="card-title" title={show.title_english || show.title}>
            {show.title_english || show.title}
          </h4>

          <div className="card-schedule-info">
            <div className="info-row">
              <Clock size={12} className="meta-icon" />
              <span>Airs {istDetails ? `${istDetails.day}s` : 'N/A'} at {istDetails ? istDetails.time : 'N/A'} (IST)</span>
            </div>
            {show.synopsis && (
              <p className="meta-synopsis">{show.synopsis}</p>
            )}
          </div>

          <div className="card-actions-discover">
            {isAlreadyTracked ? (
              <div className="tracked-status-pill">
                <Check size={14} /> Already Tracking
              </div>
            ) : (
              <button
                onClick={() => handleAddPopularShow(show)}
                disabled={isAdding === String(show.mal_id)}
                className="btn-discover-track"
              >
                {isAdding === String(show.mal_id) ? (
                  <>
                    <RefreshCw className="spin" size={14} />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus size={14} /> Track this Show
                  </>
                )}
              </button>
            )}
            {show.mal_id && (
              <a
                href={`https://myanimelist.net/anime/${show.mal_id}`}
                target="_blank"
                rel="noreferrer"
                className="btn-discover-mal"
                title="View on MyAnimeList"
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSkeletons = () => (
    <div className="airing-cards-grid">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="loading-skeleton-card">
          <div className="skeleton-image"></div>
          <div className="skeleton-body">
            <div className="skeleton-title"></div>
            <div className="skeleton-meta"></div>
            <div className="skeleton-progress"></div>
            <div className="skeleton-controls"></div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <main className="airing-page-container">
      {/* Banner / Hero Section */}
      <section className="airing-hero-banner animate-fade-in">
        <div className="hero-gradient-overlay"></div>
        <div className="hero-content">
          <div className="hero-badge">
            <Compass size={14} /> Discovery Hub
          </div>
          <h1 className="hero-title">Airing Schedule</h1>
          <p className="hero-subtitle">Track upcoming episodes, countdowns, and seasonal releases in real-time</p>
        </div>

        {/* Decorative Floating Anime Shape */}
        <div className="hero-decoration">
          <PlayCircle size={180} />
        </div>
      </section>

      {/* Sticky Filters / Tab Bar */}
      <nav className="sticky-filter-bar animate-fade-in">
        <div className="filter-bar-inner">
          <div className="filter-tabs">
            <button
              onClick={() => setActiveTab('today')}
              className={`filter-tab-btn ${activeTab === 'today' ? 'active' : ''}`}
            >
              <Tv size={16} />
              <span>Today</span>
              {todayShows.length > 0 && <span className="badge-count">{todayShows.length}</span>}
            </button>
            <button
              onClick={() => setActiveTab('week')}
              className={`filter-tab-btn ${activeTab === 'week' ? 'active' : ''}`}
            >
              <Calendar size={16} />
              <span>This Week</span>
              {airingTrackedShows.length > 0 && <span className="badge-count">{airingTrackedShows.length}</span>}
            </button>
            <button
              onClick={() => setActiveTab('upcoming')}
              className={`filter-tab-btn ${activeTab === 'upcoming' ? 'active' : ''}`}
            >
              <Clock size={16} />
              <span>Upcoming</span>
              {upcomingShows.length > 0 && <span className="badge-count">{upcomingShows.length}</span>}
            </button>
            <button
              onClick={() => setActiveTab('popular')}
              className={`filter-tab-btn ${activeTab === 'popular' ? 'active' : ''}`}
            >
              <Sparkles size={16} />
              <span>Popular<br className="mobile-only-br" /> This Season</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <section className="airing-content-section">
        {loadingTracked || isWakingUp ? (
          <div>
            {isWakingUp && (
              <div className="db-wake-notice">
                <AlertCircle className="pulse-soft" size={24} />
                <p>Database is currently waking up from idle state. Please hold on, schedules are loading...</p>
              </div>
            )}
            {renderSkeletons()}
          </div>
        ) : (
          <div className="airing-results-container">

            {/* 1. TODAY TAB */}
            {activeTab === 'today' && (
              <>
                {todayShows.length > 0 ? (
                  <div className="airing-cards-grid">
                    {todayShows.map(anime => renderAiringCard(anime))}
                  </div>
                ) : (
                  <div className="empty-schedule-state animate-fade-in">
                    <div className="empty-icon-wrap">📺</div>
                    <h3>No scheduled airings today</h3>
                    <p>No shows in your currently watching list are scheduled to air today ({currentLocalDay}).</p>
                    <button onClick={() => setActiveTab('popular')} className="empty-btn-discover">
                      Discover Seasonal Anime <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </>
            )}

            {/* 2. THIS WEEK TAB */}
            {activeTab === 'week' && (
              <>
                {airingTrackedShows.length > 0 ? (
                  <div className="weekly-schedule-layout">
                    {weekdays.map(day => {
                      const showsForDay = airingTrackedShows.filter(anime =>
                        getLocalBroadcastDay(anime.broadcastDay ?? null, anime.broadcastTime ?? null) === day
                      );
                      const isToday = currentLocalDay === day;

                      return (
                        <div key={day} className={`weekly-day-group ${isToday ? 'current-day-highlight' : ''}`}>
                          <h3 className="weekly-day-header">
                            <span className="day-name">{day}</span>
                            {isToday && <span className="today-badge">TODAY</span>}
                            <span className="day-shows-count">{showsForDay.length} shows</span>
                          </h3>

                          {showsForDay.length > 0 ? (
                            <div className="airing-cards-grid">
                              {showsForDay.map(anime => renderAiringCard(anime))}
                            </div>
                          ) : (
                            <div className="weekly-day-empty">
                              No tracked anime scheduled to air on {day}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-schedule-state animate-fade-in">
                    <div className="empty-icon-wrap">📅</div>
                    <h3>Your schedule is empty</h3>
                    <p>You aren&apos;t tracking any currently airing shows. Add active shows to your watchlist to map them out!</p>
                    <button onClick={() => setActiveTab('popular')} className="empty-btn-discover">
                      Explore Seasonal Popular Shows <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </>
            )}

            {/* 3. UPCOMING COUNTDOWN TAB */}
            {activeTab === 'upcoming' && (
              <>
                {upcomingShows.length > 0 ? (
                  <div className="airing-cards-grid">
                    {upcomingShows.map(item => renderAiringCard(item.anime))}
                  </div>
                ) : (
                  <div className="empty-schedule-state animate-fade-in">
                    <div className="empty-icon-wrap">⏳</div>
                    <h3>No upcoming countdowns</h3>
                    <p>No currently airing shows found in your lists. Sync your schedules or check recommendations.</p>
                    <button onClick={() => setActiveTab('popular')} className="empty-btn-discover">
                      Browse Airing Shows <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </>
            )}

            {/* 4. POPULAR SEASONAL RECOMMENDATIONS */}
            {activeTab === 'popular' && (
              <>
                {loadingPopular ? (
                  renderSkeletons()
                ) : popularAiring.length > 0 ? (
                  <div className="airing-cards-grid">
                    {popularAiring.map(show => renderPopularCard(show))}
                  </div>
                ) : (
                  <div className="empty-schedule-state animate-fade-in">
                    <div className="empty-icon-wrap">✨</div>
                    <h3>No recommendations loaded</h3>
                    <p>Could not retrieve trending shows from the seasonal API. Please try syncing again later.</p>
                  </div>
                )}
              </>
            )}

          </div>
        )}
      </section>

      <Toast messages={toasts} onRemove={removeToast} />
    </main>
  );
}
