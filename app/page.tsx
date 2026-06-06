"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Search, Plus, Minus, Check, Trash2, XCircle, PlaySquare, RefreshCw, PlayCircle, ChevronLeft, ChevronRight, GripVertical, AlertCircle, Download, Film, Edit2 } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import Modal from '@/components/Modal';
import Toast, { type ToastMessage } from '@/components/Toast';
import Logo from '@/components/Logo';


import { calculateAiringCountdown, countdownFromAiringAt } from '@/lib/airing-utils';
import { errorMessage } from '@/lib/api-error';
import { ApiError, isWakingUpError } from '@/lib/api';
import { formatSeasonText, parseSeasonField } from '@/lib/season-format';
import {
  useAnimeList,
  useStats,
  useJikanSearch,
  useCreateAnime,
  useUpdateAnime,
  useDeleteAnime,
  useReorderAnime,
} from '@/lib/query/hooks/anime';

/** Minimal shape of a Jikan search result used for the add-anime suggestions. */
interface Suggestion {
  mal_id: number;
  title: string;
  title_english?: string | null;
  type?: string;
  year?: number | null;
  episodes?: number | null;
  airing?: boolean;
  images?: { jpg?: { image_url?: string } };
  broadcast?: { day?: string | null; time?: string | null; timezone?: string | null; string?: string | null };
  aired?: { from?: string | null };
}

type Anime = {
  id: number;
  name: string;
  normalizedName: string;
  season: number;
  part: number | null;
  episodesWatched: number;
  totalEpisodes?: number;
  status: string;
  imageUrl: string | null;
  malId: number | null;
  watchOrder: number | null;
  airing: boolean;
  broadcastDay: string | null;
  broadcastTime: string | null;
  broadcastTimezone: string | null;
  broadcastString: string | null;
  airingStart?: string | null;
  nextEpisode?: number | null;
  nextEpisodeAt?: number | null;
  type: string;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
type TabKey = 'watching' | 'completed' | 'dropped';
const STATUS_MAP: Record<TabKey, string> = {
  watching: 'incomplete',
  completed: 'completed',
  dropped: 'dropped',
};

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [debouncedLocalSearchQuery, setDebouncedLocalSearchQuery] = useState('');
  const [searchPage, setSearchPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('watching');
  const [pageSize, setPageSize] = useState<number>(20);
  const [completedSort, setCompletedSort] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('otakumind_completed_sort') || 'completed_desc';
    }
    return 'completed_desc';
  });

  const handleSortChange = (newSort: string) => {
    setCompletedSort(newSort);
    if (typeof window !== 'undefined') {
      localStorage.setItem('otakumind_completed_sort', newSort);
    }
    setTabPages(prev => ({ ...prev, completed: 1 }));
  };

  // Track per-tab pages
  const [tabPages, setTabPages] = useState<Record<string, number>>({
    watching: 1,
    completed: 1,
    dropped: 1,
  });

  // UI state for toast & modals
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [pendingAnime, setPendingAnime] = useState<Anime | null>(null);
  const [editName, setEditName] = useState('');
  const [editTotalEpisodes, setEditTotalEpisodes] = useState('');
  const [editEpisodesWatched, setEditEpisodesWatched] = useState('');
  const [editSeason, setEditSeason] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

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

  const currentPage = tabPages[activeTab] || 1;

  // --- Data layer (React Query) ------------------------------------------

  const status = STATUS_MAP[activeTab];
  const listSearch = (activeTab === 'completed' || activeTab === 'dropped') && debouncedLocalSearchQuery
    ? debouncedLocalSearchQuery
    : undefined;
  const listSort = activeTab === 'completed' ? completedSort : undefined;

  const listQuery = useAnimeList({
    status,
    sort: listSort,
    search: listSearch,
    page: currentPage,
    limit: pageSize,
  });

  const statsQuery = useStats();
  const stats = statsQuery.data?.uniqueTotal ?? 0;
  const existingSlugs = statsQuery.data?.slugs ?? [];

  const createAnime = useCreateAnime();
  const updateAnime = useUpdateAnime();
  const deleteAnime = useDeleteAnime();
  const reorderAnime = useReorderAnime();

  // Visible list. Seeded from the query cache; the drag-reorder handler drives
  // the visible order via this local state (the reorder mutation persists
  // without refetching, so the cache won't clobber the reordered order).
  const [animes, setAnimes] = useState<Anime[]>([]);
  const pagination = listQuery.data?.pagination ?? { page: currentPage, limit: pageSize, total: 0, totalPages: 0 };
  // True while a drag-reorder PUT is in flight, so a stray refetch can't snap the
  // optimistic order back before the server confirms it.
  const reorderInFlight = useRef(false);

  // Sync local list from query data whenever the query produces fresh data.
  // Skip placeholderData (the PREVIOUS tab's rows shown while a new tab/page loads
  // — seeding it would briefly render the wrong tab's rows under the new heading),
  // and skip while a reorder is mid-flight.
  useEffect(() => {
    if (listQuery.data?.data && !listQuery.isPlaceholderData && !reorderInFlight.current) {
      setAnimes(listQuery.data.data as Anime[]);
    }
  }, [listQuery.data, listQuery.isPlaceholderData]);

  // Per-row in-flight indicator: which anime ids currently have a mutation running.
  const [updatingIds, setUpdatingIds] = useState<Record<number, boolean>>({});

  // The list query retries transient DB cold-start errors automatically; surface
  // the "database waking up" message while it is retrying.
  const isWakingUp = listQuery.isError && isWakingUpError(listQuery.error);
  // Mirror the old `loading` flag: only show skeletons before any data exists for this view.
  const loading = listQuery.isPending;

  // If the current page became empty but there are still items overall (e.g.
  // after deleting the last row on a page), drop to the last valid page.
  useEffect(() => {
    const pag = listQuery.data?.pagination;
    if (pag && listQuery.data?.data.length === 0 && pag.total > 0 && pag.page > 1) {
      const lastValidPage = Math.max(1, pag.totalPages);
      setTabPages(prev => ({ ...prev, [activeTab]: lastValidPage }));
    }
  }, [listQuery.data, activeTab]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Debounce local (completed/dropped) search query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedLocalSearchQuery(localSearchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [localSearchQuery]);

  // Reset page to 1 on local search
  useEffect(() => {
    if (activeTab === 'completed' || activeTab === 'dropped') {
      setTabPages(prev => ({ ...prev, [activeTab]: 1 }));
    }
  }, [debouncedLocalSearchQuery, activeTab]);

  // --- Jikan add-anime search --------------------------------------------

  // Debounce the Jikan search query (400ms) and reset pagination on change.
  useEffect(() => {
    setSearchPage(1);
    setHasNextPage(false);
    const delayDebounce = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 400);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  const jikanQuery = useJikanSearch(debouncedSearchQuery, searchPage);
  const isSearching = jikanQuery.isFetching;

  // Merge incoming Jikan results into the accumulated suggestion list. Page 1
  // replaces the list; subsequent pages append. Dedup by mal_id.
  useEffect(() => {
    if (debouncedSearchQuery.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    if (jikanQuery.isError) {
      addToast(errorMessage(jikanQuery.error, 'Failed to search anime'), 'warning');
      return;
    }
    const data = jikanQuery.data;
    if (!data) return;
    const items: Suggestion[] = (data.data as Suggestion[]) || [];
    setSuggestions(prev => {
      const combined = searchPage === 1 ? items : [...prev, ...items];
      return Array.from(new Map(combined.map((item) => [item.mal_id, item] as [number, Suggestion])).values());
    });
    setHasNextPage(data.pagination?.has_next_page || false);
    if (searchPage === 1 && items.length > 0) {
      setShowSuggestions(true);
    }
  }, [jikanQuery.data, jikanQuery.isError, jikanQuery.error, debouncedSearchQuery, searchPage, addToast]);

  // Click outside to close Jikan suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleInputFocus = () => {
    if (searchQuery.length >= 3 && suggestions.length > 0) {
      setShowSuggestions(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      e.currentTarget.blur();
    }
  };

  const loadMoreSuggestions = () => {
    setSearchPage(prev => prev + 1);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const bottom = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 10;
    if (bottom && hasNextPage && !isSearching) {
      loadMoreSuggestions();
    }
  };

  const handleAddAnime = async (sugg: Suggestion) => {
    if (isAdding) return;
    setIsAdding(String(sugg.mal_id));

    const newAnime = {
      name: sugg.title_english || sugg.title,
      episodesWatched: 0,
      status: 'incomplete',
      imageUrl: sugg.images?.jpg?.image_url || null,
      malId: sugg.mal_id,
      airing: sugg.airing || false,
      broadcastDay: sugg.broadcast?.day || null,
      broadcastTime: sugg.broadcast?.time || null,
      broadcastTimezone: sugg.broadcast?.timezone || null,
      broadcastString: sugg.broadcast?.string || null,
      type: sugg.type,
      totalEpisodes: sugg.episodes || 0,
      airingStart: sugg.aired?.from || null,
    };

    try {
      await createAnime.mutateAsync(newAnime);

      addToast(`Added ${newAnime.name} to Currently Watching`, 'success');
      // Since we add to top, go to page 1 of the 'watching' tab.
      if (activeTab !== 'watching') {
        setActiveTab('watching');
      }
      setTabPages(prev => ({ ...prev, watching: 1 }));
      setSearchQuery('');
      setSuggestions([]);
      setShowSuggestions(false);
    } catch (e) {
      // A 409 (duplicate) is surfaced via ApiError with the original body.
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { type?: string; existingAnime?: Anime } | undefined;
        if (body?.type === 'DUPLICATE_INCOMPLETE') {
          addToast('This anime is already in your watching list', 'warning');
        } else if (body?.type === 'DUPLICATE_OTHER_STATUS' && body.existingAnime) {
          setPendingAnime(body.existingAnime);
          setShowMoveModal(true);
        }
        setSearchQuery('');
        setSuggestions([]);
        setShowSuggestions(false);
      } else {
        console.error(e);
        addToast('Failed to add anime', 'warning');
      }
    } finally {
      setIsAdding(null);
    }
  };

  // Update an anime via the mutation hook. Mirrors the previous optimistic UX:
  // immediately reflect the change locally (a status change removes the row from
  // the current list; a plain field change patches it in place), surface the
  // per-row spinner, and roll back the local list on error. The hook handles the
  // cache patching/invalidation; the returned row is used by the edit modal.
  const runUpdate = async (id: number, updates: Partial<Anime>): Promise<Anime> => {
    if (updatingIds[id]) {
      throw new Error('Update already in flight');
    }

    setUpdatingIds(prev => ({ ...prev, [id]: true }));

    const backup = animes;

    // Optimistic local update
    if (updates.status) {
      setAnimes(prev => prev.filter(a => a.id !== id));
    } else {
      setAnimes(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
    }

    try {
      const data = await updateAnime.mutateAsync({ id, ...updates });
      if (!updates.status) {
        // Reflect the exact server data for in-place edits.
        setAnimes(prev => prev.map(a => a.id === id ? { ...a, ...(data as Anime) } : a));
      }
      return data as Anime;
    } catch (e) {
      // Revert optimistic update
      setAnimes(backup);
      throw e;
    } finally {
      setUpdatingIds(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleMoveToWatching = async () => {
    if (!pendingAnime) return;

    try {
      await runUpdate(pendingAnime.id, { status: 'incomplete' });

      addToast(`Moved ${pendingAnime.name} to Watching at the top`, 'success');
      setShowMoveModal(false);
      setPendingAnime(null);

      setActiveTab('watching');
      setTabPages(prev => ({ ...prev, watching: 1 }));
    } catch {
      addToast('Failed to move anime', 'warning');
    }
  };

  const handleDeleteInitiate = (anime: Anime) => {
    setPendingAnime(anime);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!pendingAnime) return;
    const id = pendingAnime.id;
    const backup = animes;

    setIsDeleting(true);

    // Optimistic removal
    setAnimes(prev => prev.filter(a => a.id !== id));

    try {
      await deleteAnime.mutateAsync(id);

      // Close modal and show toast immediately on success
      setShowDeleteModal(false);
      addToast(`Permanently deleted ${pendingAnime.name}`, 'success');
    } catch {
      setAnimes(backup);
      addToast('Failed to delete anime', 'warning');
    } finally {
      setIsDeleting(false);
      setPendingAnime(null);
    }
  };

  const handleEditInitiate = (anime: Anime) => {
    setPendingAnime(anime);
    setEditName(anime.name);
    setEditTotalEpisodes(anime.type === 'Movie' ? '0' : String(anime.totalEpisodes || 0));
    setEditEpisodesWatched(anime.type === 'Movie' ? '0' : String(anime.episodesWatched || 0));
    setEditSeason(formatSeasonText(anime.season, anime.part, anime.type));
    setEditSlug(anime.normalizedName);
    setEditError(null);
    setShowEditModal(true);
  };

  const handleEditConfirm = async () => {
    if (!pendingAnime) return;

    const { season, part, type } = parseSeasonField(editSeason);
    const isMovieSelected = type === 'Movie';

    // Frontend validation (for non-movies)
    if (!isMovieSelected) {
      const watched = parseInt(editEpisodesWatched, 10);
      const total = parseInt(editTotalEpisodes, 10);

      if (isNaN(watched) || watched < 0) {
        setEditError("Watched episodes must be a non-negative number.");
        return;
      }
      if (isNaN(total) || total < 0) {
        setEditError("Total episodes must be a non-negative number.");
        return;
      }
      if (total > 0 && watched > total) {
        setEditError("Watched episodes cannot exceed total episodes.");
        return;
      }
    }

    if (!editSlug.trim()) {
      setEditError("Subtitle / Slug field cannot be empty.");
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);

    try {
      const updates = {
        name: editName.trim(),
        season,
        part,
        normalizedName: editSlug.trim().toLowerCase(),
        type,
        totalEpisodes: isMovieSelected ? 0 : parseInt(editTotalEpisodes, 10),
        episodesWatched: isMovieSelected ? 0 : parseInt(editEpisodesWatched, 10),
      };

      const updatedAnime = await runUpdate(pendingAnime.id, updates);

      // Instantly update local state with exact data returned from API
      setAnimes(prev => prev.map(a => a.id === pendingAnime.id ? { ...a, ...updatedAnime } : a));
      addToast(`Updated "${editName.trim()}" successfully!`, 'success');
      setShowEditModal(false);
      setPendingAnime(null);
    } catch (e: unknown) {
      setEditError(errorMessage(e, "Failed to save changes. Please try again."));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDropInitiate = async (anime: Anime) => {
    if (updatingIds[anime.id]) return;
    try {
      addToast(`Moved ${anime.name} to Dropped`, 'info', 900);
      await runUpdate(anime.id, { status: 'dropped' });
    } catch {
      addToast("Failed to drop anime", "warning");
    }
  };

  // Drag-and-drop reorder handler
  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index) return;

    const reordered = Array.from(animes);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    // Compute new watchOrder values based on current page offset
    const offset = (currentPage - 1) * pageSize;
    const items = reordered.map((anime, index) => ({
      id: anime.id,
      watchOrder: offset + index + 1,
    }));

    // Optimistic UI update — local state drives the visible order.
    const optimisticAnimes = reordered.map((anime, index) => ({
      ...anime,
      watchOrder: offset + index + 1,
    }));
    setAnimes(optimisticAnimes);

    reorderInFlight.current = true;
    try {
      await reorderAnime.mutateAsync(items);
    } catch (e) {
      // Rollback on failure — refetch the current view from the server.
      console.error('Reorder failed:', e);
      listQuery.refetch();
    } finally {
      reorderInFlight.current = false;
    }
  };

  const handleExportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    addToast("Generating Excel file, please wait...", "info", 3000);

    try {
      const response = await fetch('/api/anime/export');
      if (!response.ok) {
        throw new Error('Export request failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'OtakuMind_Anime_Collection.xlsx');
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);

      addToast("Collection exported successfully!", "success");
    } catch (e) {
      console.error(e);
      addToast("Failed to export collection", "warning");
    } finally {
      setIsExporting(false);
    }
  };

  const goToPage = (page: number) => {
    setTabPages(prev => ({ ...prev, [activeTab]: page }));
  };

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setLocalSearchQuery('');
    setDebouncedLocalSearchQuery('');
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);

    setTabPages({ watching: 1, completed: 1, dropped: 1 });
  };

  const renderPagination = () => {
    if (pagination.totalPages <= 1) return null;

    const pages: (number | '...')[] = [];
    const { page, totalPages } = pagination;

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }

    return (
      <div className="pagination-controls animate-fade-in">
        <button
          className="pagination-btn"
          onClick={() => goToPage(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft size={16} />
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="pagination-ellipsis">…</span>
          ) : (
            <button
              key={p}
              className={`pagination-btn ${p === page ? 'active' : ''}`}
              onClick={() => goToPage(p)}
            >
              {p}
            </button>
          )
        )}

        <button
          className="pagination-btn"
          onClick={() => goToPage(page + 1)}
          disabled={page >= totalPages}
        >
          <ChevronRight size={16} />
        </button>

        <div className="pagination-info">
          <span>{pagination.total} anime</span>
        </div>
      </div>
    );
  };



  const isWatchingTab = activeTab === 'watching';


  const renderList = () => {
    if (animes.length === 0 && !loading) return <p className="empty-state">No anime found</p>;

    const listContent = (
      <>
        <div className="compact-list-header">
          {isWatchingTab && <span className="col-drag"></span>}
          <span className="col-title">Anime</span>
          <span className="col-ep">Progress</span>
          <span className="col-actions">Actions</span>
        </div>

        {isWatchingTab ? (
          <Droppable droppableId="anime-list">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`droppable-area ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
              >
                {animes.map((anime, i) => (
                  <Draggable key={anime.id} draggableId={String(anime.id)} index={i}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`compact-list-row draggable-row ${snapshot.isDragging ? 'is-dragging' : ''}`}
                        style={{
                          ...provided.draggableProps.style,
                          animationDelay: `${i * 20}ms`,
                        }}
                      >
                        <div className="col-drag-handle" {...provided.dragHandleProps}>
                          <GripVertical size={16} />
                        </div>
                        <div className="col-title-info">
                          <div className="anime-title-row">
                            <span className="anime-title-main">{anime.name}</span>
                            {anime.airing && (() => {
                              const countdown = countdownFromAiringAt(anime.nextEpisodeAt) ?? calculateAiringCountdown(anime.broadcastDay, anime.broadcastTime);
                              if (!countdown) return null;
                              const label = anime.nextEpisode ? `Ep ${anime.nextEpisode} ${countdown.label}` : `Next episode ${countdown.label}`;
                              return (
                                <span className={`airing-pill-badge ${countdown.isAiringNow ? 'airing-now' : countdown.isToday ? 'airing-today' : ''}`} title={anime.broadcastString || ''}>
                                  {countdown.isAiringNow ? '🟢 Airing Now' : label}
                                </span>
                              );
                            })()}
                          </div>
                          <span className="anime-meta-mini">{formatSeasonText(anime.season, anime.part, anime.type)} &middot; {anime.normalizedName}</span>
                        </div>

                        <div className="col-ep-control">
                          {anime.type === 'Movie' ? (
                            <span className="movie-badge">
                              <Film size={14} />
                              Movie
                            </span>
                          ) : (
                            <>
                              <div className="ep-display">
                                <span className="count">{anime.episodesWatched}</span>
                                <small>eps</small>
                              </div>
                              <div className="ep-btns">
                                <button
                                  onClick={() => runUpdate(anime.id, { episodesWatched: Math.max(0, anime.episodesWatched - 1) })}
                                  className="btn-mini"
                                  disabled={!!updatingIds[anime.id]}
                                >
                                  <Minus size={14} />
                                </button>
                                <button
                                  onClick={() => runUpdate(anime.id, { episodesWatched: anime.episodesWatched + 1 })}
                                  className="btn-mini primary"
                                  disabled={!!updatingIds[anime.id] || (anime.totalEpisodes !== undefined && anime.totalEpisodes > 0 && anime.episodesWatched >= anime.totalEpisodes)}
                                  title={anime.totalEpisodes !== undefined && anime.totalEpisodes > 0 && anime.episodesWatched >= anime.totalEpisodes ? "Progress reached total episodes" : "Increment episodes"}
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>

                        <div className="col-actions-group">
                          {updatingIds[anime.id] ? (
                            <div className="row-loader" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '92px' }}>
                              <RefreshCw className="spin text-muted" size={16} style={{ animation: 'spin 1s linear infinite' }} />
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={() => runUpdate(anime.id, { status: 'completed' })}
                                className="btn-row success"
                                title="Complete"
                                disabled={!!updatingIds[anime.id]}
                              >
                                <Check size={16} />
                              </button>
                              <button
                                onClick={() => handleDropInitiate(anime)}
                                className="btn-row danger"
                                title="Drop"
                                disabled={!!updatingIds[anime.id]}
                              >
                                <XCircle size={16} />
                              </button>
                              <button
                                onClick={() => handleEditInitiate(anime)}
                                className="btn-row ghost"
                                title="Edit"
                                disabled={!!updatingIds[anime.id]}
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteInitiate(anime)}
                                className="btn-row ghost"
                                title="Delete"
                                disabled={!!updatingIds[anime.id]}
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        ) : (
          // Non-draggable list for completed/dropped tabs
          <div>
            {animes.map((anime, i) => (
              <div key={anime.id} className="compact-list-row" style={{ animationDelay: `${i * 20}ms` }}>
                <div className="col-title-info">
                  <span className="anime-title-main">{anime.name}</span>
                  <span className="anime-meta-mini">{formatSeasonText(anime.season, anime.part, anime.type)} &middot; {anime.normalizedName}</span>
                </div>

                <div className="col-ep-control">
                  {anime.type === 'Movie' ? (
                    <span className="movie-badge">
                      <Film size={14} />
                      Movie
                    </span>
                  ) : (
                    <>
                      <div className="ep-display">
                        <span className="count">{anime.episodesWatched}</span>
                        <small>eps</small>
                      </div>
                      <div className="ep-btns">
                        <button
                          onClick={() => runUpdate(anime.id, { episodesWatched: Math.max(0, anime.episodesWatched - 1) })}
                          className="btn-mini"
                          disabled={!!updatingIds[anime.id]}
                        >
                          <Minus size={14} />
                        </button>
                        <button
                          onClick={() => runUpdate(anime.id, { episodesWatched: anime.episodesWatched + 1 })}
                          className="btn-mini primary"
                          disabled={!!updatingIds[anime.id] || (anime.totalEpisodes !== undefined && anime.totalEpisodes > 0 && anime.episodesWatched >= anime.totalEpisodes)}
                          title={anime.totalEpisodes !== undefined && anime.totalEpisodes > 0 && anime.episodesWatched >= anime.totalEpisodes ? "Progress reached total episodes" : "Increment episodes"}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="col-actions-group">
                  {updatingIds[anime.id] ? (
                    <div className="row-loader" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '92px' }}>
                      <RefreshCw className="spin text-muted" size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    </div>
                  ) : (
                    <>
                      {activeTab !== 'completed' && (
                        <button
                          onClick={() => runUpdate(anime.id, { status: 'completed' })}
                          className="btn-row success"
                          title="Complete"
                          disabled={!!updatingIds[anime.id]}
                        >
                          <Check size={16} />
                        </button>
                      )}
                      {activeTab !== 'watching' as string && (
                        <button
                          onClick={() => runUpdate(anime.id, { status: 'incomplete' })}
                          className="btn-row"
                          title="Watching"
                          disabled={!!updatingIds[anime.id]}
                        >
                          <PlaySquare size={16} />
                        </button>
                      )}
                      {activeTab !== 'dropped' && (
                        <button
                          onClick={() => handleDropInitiate(anime)}
                          className="btn-row danger"
                          title="Drop"
                          disabled={!!updatingIds[anime.id]}
                        >
                          <XCircle size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => handleEditInitiate(anime)}
                        className="btn-row ghost"
                        title="Edit"
                        disabled={!!updatingIds[anime.id]}
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteInitiate(anime)}
                        className="btn-row ghost"
                        title="Delete"
                        disabled={!!updatingIds[anime.id]}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );

    return (
      <div className={`compact-list animate-fade-in ${isWatchingTab ? 'has-drag' : ''}`}>
        {listContent}
      </div>
    );
  };

  return (
    <main className="dashboard dashboard-home">
      <header className="header">
        <div className="header-inner">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            <Logo size={38} />
            <div>
              <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>OtakuMind</h1>
              <p className="tagline">Your minimalist anime journey</p>
            </div>
          </div>

          <div className="stats-box">
            <span className="stats-label">Total Unique Anime</span>
            <span className="stats-number">{stats}</span>
          </div>
        </div>
      </header>

      {activeTab === 'watching' && (
        <div className="search-section animate-fade-in" ref={searchContainerRef}>
          <div className="search-wrapper">
            <Search className="search-icon" size={20} />
            <input
              type="text"
              placeholder="Search anime to add..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={handleInputFocus}
              onKeyDown={handleKeyDown}
              className="search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => {
                  setSearchQuery('');
                  setSuggestions([]);
                  setShowSuggestions(false);
                }}
                title="Clear search"
              >
                <XCircle size={18} />
              </button>
            )}
          </div>

          {showSuggestions && suggestions.length > 0 && (
            <div className="search-suggestions animate-fade-in" onScroll={handleScroll}>
              {suggestions.map((sugg) => (
                <div
                  key={sugg.mal_id}
                  className={`suggestion-item ${isAdding === String(sugg.mal_id) ? 'is-adding' : ''}`}
                  onClick={() => handleAddAnime(sugg)}
                >
                  <img src={sugg.images?.jpg?.image_url} alt="" className="sugg-img" />
                  <div className="sugg-info">
                    <h4>{sugg.title_english || sugg.title}</h4>
                    {sugg.title_english && sugg.title_english !== sugg.title && (
                      <span style={{ display: 'block', fontSize: '0.85em', opacity: 0.8, marginBottom: '2px' }}>
                        {sugg.title}
                      </span>
                    )}
                    <span>{sugg.year || 'N/A'} &middot; {sugg.type}</span>
                  </div>
                  <button className="btn-add" disabled={isAdding === String(sugg.mal_id)}>
                    {isAdding === String(sugg.mal_id) ? <RefreshCw className="spin" size={18} /> : <Plus size={18} />}
                  </button>
                </div>
              ))}

              {isSearching && hasNextPage && (
                <div
                  style={{
                    width: '100%',
                    padding: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent-color)',
                    borderTop: '1px solid var(--border-color)',
                    background: 'var(--bg-color)'
                  }}
                >
                  <RefreshCw className="spin" size={20} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(activeTab === 'completed' || activeTab === 'dropped') && (
        <div className="search-section animate-fade-in">
          <div className="search-wrapper">
            <Search className="search-icon" size={20} />
            <input
              type="text"
              placeholder={activeTab === 'completed' ? "Search completed anime..." : "Search dropped anime..."}
              value={localSearchQuery}
              onChange={e => setLocalSearchQuery(e.target.value)}
              className="search-input"
            />
            {localSearchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => {
                  setLocalSearchQuery('');
                  setDebouncedLocalSearchQuery('');
                }}
                title="Clear search"
              >
                <XCircle size={18} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="tabs-row">
        <div className="tabs">
          <button className={`tab-btn ${activeTab === 'watching' ? 'active' : ''}`} onClick={() => handleTabChange('watching')}>Currently Watching</button>
          <button className={`tab-btn ${activeTab === 'completed' ? 'active' : ''}`} onClick={() => handleTabChange('completed')}>Completed</button>
          <button className={`tab-btn ${activeTab === 'dropped' ? 'active' : ''}`} onClick={() => handleTabChange('dropped')}>Dropped</button>
        </div>

        <div className="controls-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          {activeTab === 'completed' && (
            <div className="sort-selector animate-fade-in">
              <label>Sort</label>
              <select value={completedSort} onChange={(e) => handleSortChange(e.target.value)}>
                <option value="completed_desc">Recently Completed (LIFO)</option>
                <option value="completed_asc">Oldest Completed (FIFO)</option>
                <option value="created_desc">Recently Added (LIFO)</option>
                <option value="created_asc">Oldest Added (FIFO)</option>
                <option value="alphabetical_asc">Title (A-Z)</option>
                <option value="alphabetical_desc">Title (Z-A)</option>
              </select>
            </div>
          )}

          <div className="page-size-selector">
            <label>Show</label>
            <select value={pageSize} onChange={(e) => handlePageSizeChange(Number(e.target.value))}>
              {PAGE_SIZE_OPTIONS.map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <label>per page</label>
          </div>

          <button
            className="btn-export animate-fade-in"
            onClick={handleExportExcel}
            disabled={isExporting}
            title="Export all anime to formatted Excel workbook"
          >
            {isExporting ? (
              <RefreshCw className="spin" size={15} />
            ) : (
              <Download size={15} />
            )}
            {isExporting ? 'Exporting...' : 'Export to Excel'}
          </button>
        </div>
      </div>

      {isWakingUp ? (
        <div className="loader-wrapper">
          <RefreshCw className="spin" size={40} color="#a3b18a" />
          <p style={{ marginTop: '1rem', color: 'var(--text-color)', opacity: 0.8 }}>Database is waking up, please wait...</p>
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="lists-container">
            <div className="main-lists-column">
              <section className="list-section animate-fade-in">
                <h2 className="section-title">
                  {activeTab === 'watching' && <><PlayCircle size={22} color="#a3b18a" /> Currently Watching</>}
                  {activeTab === 'completed' && <><Check size={22} color="#a3b18a" /> Completed Anime</>}
                  {activeTab === 'dropped' && <><XCircle size={22} color="#d68c8c" /> Dropped Anime</>}
                </h2>

                {loading && animes.length === 0 ? (
                  <div className={`compact-list ${activeTab === 'watching' ? 'has-drag' : ''}`}>
                    <div className="compact-list-header">
                      {activeTab === 'watching' && <span className="col-drag"></span>}
                      <span className="col-title">Anime</span>
                      <span className="col-ep">Progress</span>
                      <span className="col-actions">Actions</span>
                    </div>
                    {[1, 2, 3, 4].map((idx) => (
                      <div key={idx} className="compact-list-row skeleton-row" style={{ animationDelay: `${idx * 40}ms` }}>
                        {activeTab === 'watching' && (
                          <div className="col-drag-handle" style={{ opacity: 0.4 }}>
                            <GripVertical size={16} />
                          </div>
                        )}
                        <div className="col-title-info">
                          <div className="skeleton-bar shimmer" style={{ width: '45%', height: '1.2rem', marginBottom: '0.4rem' }}></div>
                          <div className="skeleton-bar shimmer" style={{ width: '25%', height: '0.85rem' }}></div>
                        </div>
                        <div className="col-ep-control">
                          <div className="skeleton-bar shimmer" style={{ width: '60px', height: '1.5rem' }}></div>
                        </div>
                        <div className="col-actions-group">
                          <div className="skeleton-bar shimmer" style={{ width: '100px', height: '2rem' }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {renderList()}
                    {renderPagination()}
                  </>
                )}
              </section>

              <div className="dashboard-promo">
                <p>Looking for your original detailed history with numbering?</p>
                <Link href="/original-list" className="btn-link">View Original Numbered List &rarr;</Link>
              </div>
            </div>
          </div>
        </DragDropContext>
      )}
      <Toast messages={toasts} onRemove={removeToast} />

      <Modal
        isOpen={showMoveModal}
        onClose={() => { setShowMoveModal(false); setPendingAnime(null); }}
        title="Anime Already Exists"
      >
        <div className="move-modal-inner">
          <div className="move-modal-icon">
            <AlertCircle size={40} color="#a3b18a" />
          </div>
          <p>
            <strong>{pendingAnime?.name}</strong> is currently in your <strong>{pendingAnime?.status === 'incomplete' ? 'Watching' : pendingAnime?.status}</strong> list.
          </p>
          <p>Would you like to move it to Currently Watching at the <strong>very top</strong> of your list?</p>
          <div className="modal-actions">
            <button className="modal-btn secondary" onClick={() => { setShowMoveModal(false); setPendingAnime(null); }}>
              No, Keep It
            </button>
            <button className="modal-btn primary" onClick={handleMoveToWatching}>
              Yes, Move to Top
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => { if (!isDeleting) { setShowDeleteModal(false); setPendingAnime(null); } }}
        title="Delete Anime"
      >
        <div className="move-modal-inner">
          <div className="move-modal-icon">
            <Trash2 size={42} color="#d68c8c" />
          </div>
          <p>
            Are you sure you want to delete <strong>{pendingAnime?.name}</strong>?
          </p>
          <p className="modal-description-sub">This action is permanent and will remove all tracking history for this anime.</p>
          <div className="modal-actions">
            <button
              className="modal-btn secondary"
              onClick={() => { setShowDeleteModal(false); setPendingAnime(null); }}
              disabled={isDeleting}
            >
              No, Keep It
            </button>
            <button
              className="modal-btn danger"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              {isDeleting ? (
                <>
                  <RefreshCw className="spin" size={16} />
                  Deleting...
                </>
              ) : (
                'Delete Permanently'
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => { if (!isSavingEdit) { setShowEditModal(false); setPendingAnime(null); } }}
        title="Edit Anime"
      >
        <div className="edit-modal-inner animate-fade-in">
          {editError && <div className="form-error">{editError}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="edit-name">Anime Name</label>
            <input
              id="edit-name"
              type="text"
              className="form-input"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              disabled={isSavingEdit}
              placeholder="Enter anime name..."
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="edit-season">Season</label>
            <input
              id="edit-season"
              type="text"
              list="season-options"
              className="form-input"
              value={editSeason}
              onChange={e => setEditSeason(e.target.value)}
              disabled={isSavingEdit}
              placeholder="e.g. Season 1, Final Season, Movie..."
            />
            <datalist id="season-options">
              <option value="Season 1" />
              <option value="Season 2" />
              <option value="Season 3" />
              <option value="Season 4" />
              <option value="Season 5" />
              <option value="Season 4 Part 1" />
              <option value="Season 4 Part 2" />
              <option value="Final Season" />
              <option value="Movie" />
              <option value="OVA" />
              <option value="ONA" />
              <option value="Special" />
            </datalist>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="edit-slug">Subtitle / Slug</label>
            <input
              id="edit-slug"
              type="text"
              list="slug-options"
              className="form-input"
              value={editSlug}
              onChange={e => setEditSlug(e.target.value)}
              disabled={isSavingEdit}
              placeholder="e.g. death note, one punch man..."
            />
            <datalist id="slug-options">
              {existingSlugs.map(slug => (
                <option key={slug} value={slug} />
              ))}
            </datalist>
          </div>

          {editSeason.trim().toLowerCase() === 'movie' ? (
            <div className="movie-modal-note">
              This entry is a Movie. Episode tracking is not applicable.
            </div>
          ) : (
            <>
              {pendingAnime && pendingAnime.totalEpisodes !== undefined && pendingAnime.totalEpisodes !== null && pendingAnime.totalEpisodes > 0 ? (
                <div className="form-group">
                  <label className="form-label" htmlFor="edit-total-episodes">Total Episodes</label>
                  <input
                    id="edit-total-episodes"
                    type="number"
                    min="0"
                    className="form-input"
                    value={editTotalEpisodes}
                    onChange={e => setEditTotalEpisodes(e.target.value)}
                    disabled={isSavingEdit}
                    placeholder="e.g. 12, 24, 100"
                  />
                </div>
              ) : null}

              <div className="form-group">
                <label className="form-label" htmlFor="edit-progress">Episodes Watched</label>
                <input
                  id="edit-progress"
                  type="number"
                  min="0"
                  className="form-input"
                  value={editEpisodesWatched}
                  onChange={e => setEditEpisodesWatched(e.target.value)}
                  disabled={isSavingEdit}
                  placeholder="Current progress..."
                />
              </div>
            </>
          )}

          <div className="modal-actions">
            <button
              className="modal-btn secondary"
              onClick={() => { setShowEditModal(false); setPendingAnime(null); }}
              disabled={isSavingEdit}
            >
              Cancel
            </button>
            <button
              className="modal-btn primary"
              onClick={handleEditConfirm}
              disabled={isSavingEdit || !editName.trim() || !editSlug.trim()}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              {isSavingEdit ? (
                <>
                  <RefreshCw className="spin" size={16} />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </div>
      </Modal>

    </main>
  );
}
