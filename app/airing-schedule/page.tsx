"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
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
import { errorMessage } from '@/lib/api-error';

type Anime = {
  id: number;
  name: string;
  normalizedName: string;
  season: number;
  episodesWatched: number;
  status: string;
  imageUrl: string | null;
  malId: number | null;
  airing: boolean;
  broadcastDay: string | null;
  broadcastTime: string | null;
  broadcastTimezone: string | null;
  broadcastString: string | null;
  airingStart?: string | null;
  nextEpisode?: number | null;
  nextEpisodeAt?: number | null;
  type?: string;
};

type PopularShow = {
  mal_id: number;
  title: string;
  title_english: string | null;
  images: {
    jpg: {
      image_url: string | null;
    }
  };
  airing: boolean;
  broadcast: {
    day?: string | null;
    time?: string | null;
    timezone?: string | null;
    string?: string | null;
  };
  type: string;
  score: number | null;
  synopsis: string | null;
  episodes?: number | null;
  aired?: {
    from?: string | null;
  } | null;
  nextEpisode?: number | null;
  nextEpisodeAt?: number | null;
};

type TabKey = 'today' | 'week' | 'upcoming' | 'popular';

export default function AiringSchedulePage() {
  const [trackedAnime, setTrackedAnime] = useState<Anime[]>([]);
  const [popularAiring, setPopularAiring] = useState<PopularShow[]>([]);
  
  const [loadingTracked, setLoadingTracked] = useState(true);
  const [loadingPopular, setLoadingPopular] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [isAdding, setIsAdding] = useState<string | null>(null);
  
  const [activeTab, setActiveTab] = useState<TabKey>('today');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  
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

  const fetchTrackedAnime = useCallback(async (isRetry = false) => {
    if (!isRetry) {
      setLoadingTracked(true);
      setIsWakingUp(false);
    }
    try {
      // Load all incomplete (currently watching) shows to filter for airing schedule
      const res = await fetch('/api/anime?status=incomplete&limit=100');
      const json = await res.json();
      
      if (!res.ok) throw new Error(json.error || 'Failed to fetch tracked anime');
      
      setTrackedAnime(json.data || []);
      setIsWakingUp(false);
      setLoadingTracked(false);
    } catch (err: unknown) {
      console.error(err);
      const msg = errorMessage(err, String(err));
      if (msg.includes('SSL connection') || msg.includes('consuming input failed') || msg.includes('Database error') || msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
        setIsWakingUp(true);
        setTimeout(() => {
          fetchTrackedAnime(true);
        }, 3000);
      } else {
        setLoadingTracked(false);
      }
    }
  }, []);

  const fetchPopularAiring = useCallback(async () => {
    setLoadingPopular(true);
    try {
      const res = await fetch('/api/anime/popular-airing');
      const json = await res.json();
      
      if (!res.ok) throw new Error(json.error || 'Failed to fetch seasonal airing anime');
      
      // Deduplicate before setting state to ensure cards render uniquely
      const data = json.data || [];
      const seenIds = new Set<number>();
      const uniqueData = data.filter((show: PopularShow) => {
        if (!show.mal_id || seenIds.has(show.mal_id)) {
          return false;
        }
        seenIds.add(show.mal_id);
        return true;
      });
      
      setPopularAiring(uniqueData);
    } catch (err) {
      console.error(err);
      addToast("Could not load popular seasonal recommendations", "warning");
    } finally {
      setLoadingPopular(false);
    }
  }, [addToast]);

  const handleSyncAiring = async () => {
    setIsSyncing(true);
    addToast("Syncing airing schedules from Jikan API...", "info", 3000);
    try {
      const res = await fetch('/api/anime/sync-airing', { method: 'POST' });
      const json = await res.json();
      
      if (!res.ok) throw new Error(json.error || 'Failed to sync schedule');
      
      if (json.syncedCount > 0) {
        addToast(`Synced airing details for ${json.syncedCount} anime!`, "success");
        void fetchTrackedAnime();
      } else {
        addToast("Airing details are already up to date.", "info");
      }
    } catch (e) {
      console.error(e);
      addToast("Failed to sync airing details", "warning");
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchTrackedAnime();
    fetchPopularAiring();
  }, [fetchTrackedAnime, fetchPopularAiring]);

  const handleUpdateEpisode = async (id: number, currentCount: number, change: number) => {
    const newCount = Math.max(0, currentCount + change);
    
    // Optimistic UI updates
    setTrackedAnime(prev => prev.map(anime => 
      anime.id === id ? { ...anime, episodesWatched: newCount } : anime
    ));

    try {
      const res = await fetch(`/api/anime/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodesWatched: newCount })
      });
      const json = await res.json();
      
      if (!res.ok) throw new Error(json.error || 'Failed to update episodes');
    } catch (e) {
      console.error(e);
      addToast("Failed to update progress on database", "warning");
      // Rollback
      setTrackedAnime(prev => prev.map(anime => 
        anime.id === id ? { ...anime, episodesWatched: currentCount } : anime
      ));
    }
  };

  const handleAddPopularShow = async (show: PopularShow) => {
    if (isAdding) return;
    setIsAdding(String(show.mal_id));
    
    try {
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
      
      const res = await fetch('/api/anime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAnime)
      });

      const json = await res.json();

      if (res.status === 409) {
        addToast(`"${newAnime.name}" is already in your watchlist.`, "info");
        return;
      }

      if (!res.ok) throw new Error(json.error || 'Failed to add anime');

      addToast(`Added "${newAnime.name}" to Currently Watching!`, "success");
      void fetchTrackedAnime();
    } catch (e) {
      console.error(e);
      addToast("Failed to add anime to watchlist", "warning");
    } finally {
      setIsAdding(null);
    }
  };

  // Filter shows currently airing
  const airingTrackedShows = trackedAnime.filter(anime => anime.airing);

  // Grouped datasets
  const todayShows = airingTrackedShows.filter(anime => {
    const localDay = getLocalBroadcastDay(anime.broadcastDay, anime.broadcastTime);
    return localDay === currentLocalDay;
  });

  const upcomingShows = airingTrackedShows
    .map(anime => {
      const countdown = calculateAiringCountdown(anime.broadcastDay, anime.broadcastTime);
      return { anime, countdown };
    })
    .filter(item => item.countdown !== null)
    .sort((a, b) => (a.countdown?.diffMs || 0) - (b.countdown?.diffMs || 0));

  const renderAiringCard = (anime: Anime) => {
    const countdown = countdownFromAiringAt(anime.nextEpisodeAt) ?? calculateAiringCountdown(anime.broadcastDay, anime.broadcastTime);
    const istDetails = getISTBroadcastDetails(anime.broadcastDay, anime.broadcastTime);

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

  const renderPopularCard = (show: PopularShow) => {
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
          
          <div className="hero-action-row">
            <button 
              onClick={handleSyncAiring}
              disabled={isSyncing}
              className="btn-hero-sync"
            >
              <RefreshCw className={isSyncing ? 'spin' : ''} size={16} />
              <span>{isSyncing ? 'Syncing schedules...' : 'Sync Schedules'}</span>
            </button>
            <div className="sync-timestamp-notice">
              Refreshes from the Jikan MAL API
            </div>
          </div>
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
                        getLocalBroadcastDay(anime.broadcastDay, anime.broadcastTime) === day
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
