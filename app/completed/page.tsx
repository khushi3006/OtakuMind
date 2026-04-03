"use client";

import { useState, useEffect, useCallback } from 'react';
import { Search, ExternalLink, CalendarDays, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

type Anime = {
  id: number;
  name: string;
  normalizedName: string;
  season: number;
  episodesWatched: number;
  status: string;
  imageUrl: string | null;
  malId: number | null;
  originalOrder: number | null;
  type: string;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export default function CompletedPage() {
  const [animes, setAnimes] = useState<Anime[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState(1);

  // Two-tier search state
  const [isServerSearching, setIsServerSearching] = useState(false);
  const [serverSearchResults, setServerSearchResults] = useState<Anime[] | null>(null);
  const [serverSearchPagination, setServerSearchPagination] = useState<Pagination | null>(null);


  const fetchAnimes = useCallback(async (pg: number, force = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/anime?status=completed&page=${pg}&limit=${pageSize}`);
      const json = await res.json();
      setAnimes(json.data || []);
      setPagination(json.pagination || { page: pg, limit: pageSize, total: 0, totalPages: 0 });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    fetchAnimes(page);
  }, [page, fetchAnimes]);

  // Two-tier search
  const clientFiltered = searchQuery
    ? animes.filter(a =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.normalizedName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : animes;

  const hasClientResults = searchQuery ? clientFiltered.length > 0 : true;

  useEffect(() => {
    if (!searchQuery || hasClientResults) {
      setServerSearchResults(null);
      setServerSearchPagination(null);
      return;
    }

    setIsServerSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/anime?status=completed&search=${encodeURIComponent(searchQuery)}&page=1&limit=${pageSize}`);
        const json = await res.json();
        setServerSearchResults(json.data || []);
        setServerSearchPagination(json.pagination || null);
      } catch (e) {
        console.error(e);
      } finally {
        setIsServerSearching(false);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [searchQuery, hasClientResults, pageSize]);

  const displayList = searchQuery
    ? (hasClientResults ? clientFiltered : (serverSearchResults || []))
    : animes;

  const displayPagination = searchQuery && !hasClientResults && serverSearchPagination
    ? serverSearchPagination
    : pagination;

  const isShowingServerResults = searchQuery && !hasClientResults && serverSearchResults !== null;

  const goToPage = (pg: number) => {
    setPage(pg);
    setServerSearchResults(null);
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

      {loading ? (
        <div className="loader-wrapper"><RefreshCw className="spin" size={40} color="#a3b18a" /></div>
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
                    <CalendarDays size={12} /> Season {anime.season} 
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
