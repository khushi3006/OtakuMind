"use client";

import { useState, useEffect } from 'react';
import { Search, ExternalLink, CalendarDays, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { errorMessage } from '@/lib/api-error';
import { useAnimeList } from '@/lib/query/hooks/anime';

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export function formatSeasonText(season: number, type: string): string {
  if (type === 'Movie') return 'Movie';
  if (type === 'OVA') return 'OVA';
  if (type === 'ONA') return 'ONA';
  if (type === 'Special') return 'Special';
  if (season === 99) return 'Final Season';
  return `Season ${season}`;
}

function isWakingUpError(err: unknown): boolean {
  if (!err) return false;
  const msg = errorMessage(err, String(err));
  return (
    msg.includes('SSL connection') ||
    msg.includes('consuming input failed') ||
    msg.includes('Database error')
  );
}

const EMPTY_PAGINATION = { page: 1, limit: 20, total: 0, totalPages: 0 };

export default function OriginalListPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Main completed list for the current page.
  const listQuery = useAnimeList({ status: 'completed', page, limit: pageSize });
  const animes = listQuery.data?.data ?? [];
  const pagination = listQuery.data?.pagination ?? { ...EMPTY_PAGINATION, page, limit: pageSize };

  // The query retries automatically; surface the "database waking up" message
  // while it is retrying a transient DB connection error.
  const isWakingUp = listQuery.isError && isWakingUpError(listQuery.error);
  // Mirror the old `loading` flag: only show the spinner before any data exists.
  const loading = listQuery.isPending;

  // Two-tier search: first filter the current page, then fall back to server search.
  const clientFiltered = searchQuery
    ? animes.filter(a =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.normalizedName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : animes;

  const hasClientResults = searchQuery ? clientFiltered.length > 0 : true;

  // Debounce the search term that drives the server-side fallback search.
  useEffect(() => {
    if (!searchQuery || hasClientResults) {
      setDebouncedSearch("");
      return;
    }
    const timeout = setTimeout(() => setDebouncedSearch(searchQuery), 500);
    return () => clearTimeout(timeout);
  }, [searchQuery, hasClientResults]);

  // Server-side search across all completed anime when the current page has no match.
  const serverSearchEnabled = !!debouncedSearch && !hasClientResults;
  const serverSearchQuery = useAnimeList({
    status: 'completed',
    search: debouncedSearch || undefined,
    page: 1,
    limit: pageSize,
    enabled: serverSearchEnabled,
  });

  const serverSearchResults = serverSearchEnabled ? (serverSearchQuery.data?.data ?? null) : null;
  const serverSearchPagination = serverSearchEnabled ? (serverSearchQuery.data?.pagination ?? null) : null;
  const isServerSearching = serverSearchEnabled && serverSearchQuery.isFetching && serverSearchResults === null;

  // Decide which list to display.
  const displayList = searchQuery
    ? (hasClientResults ? clientFiltered : (serverSearchResults || []))
    : animes;

  const displayPagination = searchQuery && !hasClientResults && serverSearchPagination
    ? serverSearchPagination
    : pagination;

  const isShowingServerResults = searchQuery && !hasClientResults && serverSearchResults !== null;

  const goToPage = (pg: number) => {
    setPage(pg);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  const renderPagination = () => {
    const pag = displayPagination;
    if (pag.totalPages <= 1) return null;

    const pages: (number | '...')[] = [];
    if (pag.totalPages <= 7) {
      for (let i = 1; i <= pag.totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (pag.page > 3) pages.push('...');
      for (let i = Math.max(2, pag.page - 1); i <= Math.min(pag.totalPages - 1, pag.page + 1); i++) {
        pages.push(i);
      }
      if (pag.page < pag.totalPages - 2) pages.push('...');
      pages.push(pag.totalPages);
    }

    return (
      <div className="pagination-controls animate-fade-in">
        <button className="pagination-btn" onClick={() => goToPage(pag.page - 1)} disabled={pag.page <= 1}>
          <ChevronLeft size={16} />
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="pagination-ellipsis">…</span>
          ) : (
            <button key={p} className={`pagination-btn ${p === pag.page ? 'active' : ''}`} onClick={() => goToPage(p)}>
              {p}
            </button>
          )
        )}
        <button className="pagination-btn" onClick={() => goToPage(pag.page + 1)} disabled={pag.page >= pag.totalPages}>
          <ChevronRight size={16} />
        </button>
        <div className="pagination-info">
          <span>{pag.total} anime</span>
        </div>
      </div>
    );
  };

  return (
    <main className="completed-view">
      <header className="page-header animate-fade-in">
        <div className="header-content">
          <div className="badge">History</div>
          <h1>Original Completed List</h1>
          <p className="subtitle">All {displayPagination.total} entries from your initial archives, preserved with original numbering.</p>
        </div>

        <div className="search-bar">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search your history..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </header>

      {isShowingServerResults && (
        <div className="search-scope-notice animate-fade-in">
          Not found on this page — showing results from all completed anime
        </div>
      )}

      {isServerSearching && (
        <div className="search-scope-notice animate-fade-in">
          <RefreshCw className="spin" size={14} /> Searching across all anime...
        </div>
      )}

      <div className="list-toolbar">
        <div className="page-size-selector">
          <label>Show</label>
          <select value={pageSize} onChange={(e) => handlePageSizeChange(Number(e.target.value))}>
            {PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          <label>per page</label>
        </div>
      </div>

      {loading || isWakingUp ? (
        <div className="loader-wrapper">
          <RefreshCw className="spin" size={40} color="#a3b18a" />
          {isWakingUp && <p style={{ marginTop: '1rem', color: 'var(--text-color)', opacity: 0.8 }}>Database is waking up, please wait...</p>}
        </div>
      ) : (
        <div className="list-container animate-fade-in">
          <div className="list-header">
            <span className="col-num">#</span>
            <span className="col-title">Anime Title & Details</span>
            <span className="col-type">Type</span>
            <span className="col-group">Group</span>
          </div>

          <div className="list-body">
            {displayList.map((anime) => (
              <div key={anime.id} className="list-row">
                <span className="col-num">{anime.originalOrder || '-'}</span>
                <div className="col-title-detail">
                  <span className="anime-name-text">{anime.name}</span>
                  <div className="anime-sub-details">
                    <CalendarDays size={12} /> {formatSeasonText(anime.season, anime.type)}
                    {anime.malId && (
                      <a
                        href={`https://myanimelist.net/anime/${anime.malId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mal-link"
                      >
                        MAL <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
                <span className="col-type"><span className={`type-tag ${anime.type.toLowerCase()}`}>{anime.type}</span></span>
                <span className="col-group">{anime.normalizedName}</span>
              </div>
            ))}
            {displayList.length === 0 && (
              <div className="empty-results">
                {searchQuery ? `No anime found matching "${searchQuery}"` : 'No anime found'}
              </div>
            )}
          </div>
        </div>
      )}
      {!loading && renderPagination()}
    </main>
  );
}
