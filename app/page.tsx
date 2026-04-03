"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Plus, Minus, Check, Trash2, XCircle, PlaySquare, RefreshCw, PlayCircle, ChevronLeft, ChevronRight, GripVertical, AlertCircle } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import Modal from '@/components/Modal';
import Toast, { type ToastMessage } from '@/components/Toast';


type Anime = {
  id: number;
  name: string;
  normalizedName: string;
  season: number;
  episodesWatched: number;
  status: string;
  imageUrl: string | null;
  malId: number | null;
  watchOrder: number | null;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export default function Home() {
  const [animes, setAnimes] = useState<Anime[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [stats, setStats] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);
  const [activeTab, setActiveTab] = useState<'watching' | 'completed' | 'dropped'>('watching');
  const [pageSize, setPageSize] = useState<number>(20);

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
  const [showDropModal, setShowDropModal] = useState(false);
  const [pendingAnime, setPendingAnime] = useState<Anime | null>(null);
  const [isAdding, setIsAdding] = useState<string | null>(null);

  const addToast = useCallback((message: string, type: 'success' | 'info' | 'warning' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const statusMap: Record<string, string> = {
    watching: 'incomplete',
    completed: 'completed',
    dropped: 'dropped',
  };

  const currentPage = tabPages[activeTab] || 1;

  const fetchAnimes = useCallback(async (tab: string, page: number, force = false) => {
    setLoading(true);
    try {
      const status = statusMap[tab];
      const res = await fetch(`/api/anime?status=${status}&page=${page}&limit=${pageSize}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      // If we are on a page that is now empty, but there are items in the list overall,
      // and we are not on the first page, go to the last available page.
      if (json.data.length === 0 && json.pagination.total > 0 && page > 1) {
        const lastValidPage = Math.max(1, json.pagination.totalPages);
        goToPage(lastValidPage);
        // Recursive fetch to switch to the correct page without losing loading state
        return await fetchAnimes(tab, lastValidPage, true);
      }

      setAnimes(json.data);
      setPagination(json.pagination);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats(data.uniqueTotal || 0);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Fetch on mount and whenever tab or page changes
  useEffect(() => {
    fetchAnimes(activeTab, currentPage);
  }, [activeTab, currentPage, fetchAnimes]);

  // Fetch stats only once on mount
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Debounced Jikan search
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      if (searchQuery.length >= 3) {
        fetch(`/api/search?q=${searchQuery}`)
          .then(res => res.json())
          .then(data => setSuggestions(data.data || []));
      } else {
        setSuggestions([]);
      }
    }, 400);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  const handleAddAnime = async (sugg: any) => {
    if (isAdding) return;
    setIsAdding(String(sugg.mal_id));
    
    try {
      const newAnime = {
        name: sugg.title,
        episodesWatched: 0,
        status: 'incomplete',
        imageUrl: sugg.images?.jpg?.image_url || null,
        malId: sugg.mal_id
      };
      
      const res = await fetch('/api/anime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAnime)
      });

      
      const data = await res.json();

      if (res.status === 409) {
        if (data.type === 'DUPLICATE_INCOMPLETE') {
          addToast("This anime is already in your watching list", 'warning');
        } else if (data.type === 'DUPLICATE_OTHER_STATUS') {
          setPendingAnime(data.existingAnime);
          setShowMoveModal(true);
        }
        setSearchQuery('');
        setSuggestions([]);
        return;
      }

      if (res.ok) {
        addToast(`Added ${newAnime.name} to Currently Watching`, 'success');
        // Refetch current view
        // Since we add to top, we should probably go to page 1 of 'watching' tab
        if (activeTab !== 'watching') {
          setActiveTab('watching');
        }
        setTabPages(prev => ({ ...prev, watching: 1 }));
        fetchAnimes('watching', 1, true);
        fetchStats();
        setSearchQuery('');
        setSuggestions([]);
      }

    } catch (e) {
      console.error(e);
      addToast("Failed to add anime", 'warning');
    } finally {
      setIsAdding(null);
    }
  };


  const updateAnime = async (id: number, updates: Partial<Anime>) => {
    const backup = [...animes];

    // Optimistic update
    if (updates.status) {
      // Status change → remove from current list
      setAnimes(prev => prev.filter(a => a.id !== id));
      setPagination(prev => ({ ...prev, total: prev.total - 1 }));
    } else {
      setAnimes(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
    }
    
    try {
      const res = await fetch(`/api/anime/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!res.ok) throw new Error('Update failed');



      if (updates.status) {
        fetchStats();
        // Item moved between lists, refresh current view to fill gaps
        fetchAnimes(activeTab, currentPage, true);
      }
    } catch (e) {
      // Rollback on failure
      setAnimes(backup);
    }
  };

  const handleMoveToWatching = async () => {
    if (!pendingAnime) return;
    
    try {
      // Determine top watchOrder
      const res = await fetch('/api/anime?status=incomplete&page=1&limit=1');
      const json = await res.json();
      const minOrder = json.data?.[0]?.watchOrder !== undefined ? json.data[0].watchOrder : 1;
      const newWatchOrder = (minOrder ?? 1) - 1;

      await updateAnime(pendingAnime.id, { 
        status: 'incomplete', 
        watchOrder: newWatchOrder 
      });
      
      addToast(`Moved ${pendingAnime.name} to Watching at the top`, 'success');
      setShowMoveModal(false);
      setPendingAnime(null);
      

      setActiveTab('watching');
      setTabPages(prev => ({ ...prev, watching: 1 }));
      fetchAnimes('watching', 1, true);
    } catch (e) {
      addToast("Failed to move anime", 'warning');
    }
  };


  const handleDeleteInitiate = (anime: Anime) => {
    setPendingAnime(anime);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!pendingAnime) return;
    const id = pendingAnime.id;
    
    // Optimistic removal
    setAnimes(prev => prev.filter(a => a.id !== id));
    setPagination(prev => ({ ...prev, total: prev.total - 1 }));

    try {
      await fetch(`/api/anime/${id}`, { method: 'DELETE' });
      addToast(`Permanently deleted ${pendingAnime.name}`, 'success');

      fetchStats();
      // Ensure we re-fetch to fill gaps and handle page transitions
      fetchAnimes(activeTab, currentPage, true);
    } catch (e) {
      // Refetch on error
      fetchAnimes(activeTab, currentPage, true);
      addToast("Failed to delete anime", "warning");
    } finally {
      setShowDeleteModal(false);
      setPendingAnime(null);
    }
  };

  const handleDropInitiate = (anime: Anime) => {
    setPendingAnime(anime);
    setShowDropModal(true);
  };

  const handleConfirmDrop = async () => {
    if (!pendingAnime) return;
    
    try {
      await updateAnime(pendingAnime.id, { status: 'dropped' });
      addToast(`Moved ${pendingAnime.name} to Dropped`, 'info');
    } catch (e) {
      addToast("Failed to drop anime", "warning");
    } finally {
      setShowDropModal(false);
      setPendingAnime(null);
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

    // Optimistic UI update
    const optimisticAnimes = reordered.map((anime, index) => ({
      ...anime,
      watchOrder: offset + index + 1,
    }));
    setAnimes(optimisticAnimes);



    try {
      const res = await fetch('/api/anime/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error('Reorder failed');
    } catch (e) {
      // Rollback on failure
      console.error('Reorder failed:', e);
      fetchAnimes(activeTab, currentPage, true);
    }
  };

  const handleSeed = async () => {
    setIsSeeding(true);
    try {
      await fetch('/api/seed');

      await Promise.all([
        fetchAnimes(activeTab, 1, true),
        fetchStats()
      ]);
      setTabPages(prev => ({ ...prev, [activeTab]: 1 }));
    } catch (e) {
      console.error(e);
    } finally {
      setIsSeeding(false);
    }
  };

  const goToPage = (page: number) => {
    setTabPages(prev => ({ ...prev, [activeTab]: page }));
  };

  const handleTabChange = (tab: 'watching' | 'completed' | 'dropped') => {
    setActiveTab(tab);
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
                          <span className="anime-title-main">{anime.name}</span>
                          <span className="anime-meta-mini">Season {anime.season} &middot; {anime.normalizedName}</span>
                        </div>
                        
                        <div className="col-ep-control">
                          <div className="ep-display">
                            <span className="count">{anime.episodesWatched}</span>
                            <small>eps</small>
                          </div>
                          <div className="ep-btns">
                            <button onClick={() => updateAnime(anime.id, { episodesWatched: Math.max(0, anime.episodesWatched - 1) })} className="btn-mini">
                              <Minus size={14} />
                            </button>
                            <button onClick={() => updateAnime(anime.id, { episodesWatched: anime.episodesWatched + 1 })} className="btn-mini primary">
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>
                        
                        <div className="col-actions-group">
                          <button onClick={() => updateAnime(anime.id, { status: 'completed' })} className="btn-row success" title="Complete">
                            <Check size={16} />
                          </button>
                          <button onClick={() => handleDropInitiate(anime)} className="btn-row danger" title="Drop">
                            <XCircle size={16} />
                          </button>
                          <button onClick={() => handleDeleteInitiate(anime)} className="btn-row ghost" title="Delete">
                            <Trash2 size={16} />
                          </button>
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
                  <span className="anime-meta-mini">Season {anime.season} &middot; {anime.normalizedName}</span>
                </div>
                
                <div className="col-ep-control">
                  <div className="ep-display">
                    <span className="count">{anime.episodesWatched}</span>
                    <small>eps</small>
                  </div>
                  <div className="ep-btns">
                    <button onClick={() => updateAnime(anime.id, { episodesWatched: Math.max(0, anime.episodesWatched - 1) })} className="btn-mini">
                      <Minus size={14} />
                    </button>
                    <button onClick={() => updateAnime(anime.id, { episodesWatched: anime.episodesWatched + 1 })} className="btn-mini primary">
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                
                <div className="col-actions-group">
                  {activeTab !== 'completed' && (
                    <button onClick={() => updateAnime(anime.id, { status: 'completed' })} className="btn-row success" title="Complete">
                      <Check size={16} />
                    </button>
                  )}
                  {activeTab !== 'watching' as string && (
                    <button onClick={() => updateAnime(anime.id, { status: 'incomplete' })} className="btn-row" title="Watching">
                      <PlaySquare size={16} />
                    </button>
                  )}
                  {activeTab !== 'dropped' && (
                    <button onClick={() => handleDropInitiate(anime)} className="btn-row danger" title="Drop">
                      <XCircle size={16} />
                    </button>
                  )}
                  <button onClick={() => handleDeleteInitiate(anime)} className="btn-row ghost" title="Delete">
                    <Trash2 size={16} />
                  </button>
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
    <main className="dashboard">
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <h1>OtakuMind</h1>
            <p className="tagline">Your minimalist anime journey</p>
          </div>
          
          <div className="stats-box">
            <span className="stats-label">Total Unique Anime</span>
            <span className="stats-number">{stats}</span>
          </div>
        </div>
      </header>
      
      {stats === 0 && !loading && activeTab === 'watching' && (
        <div className="seed-banner">
          <p>You have 600+ anime waiting to be loaded into your database.</p>
          <button className="btn-seed" onClick={handleSeed} disabled={isSeeding}>
            {isSeeding ? <RefreshCw className="spin" size={20} /> : <PlaySquare size={20} />}
            {isSeeding ? 'Seeding Database...' : 'Run Automated DB Seeding'}
          </button>
        </div>
      )}

      <div className="search-section">
        <div className="search-wrapper">
          <Search className="search-icon" size={20} />
          <input 
            type="text" 
            placeholder="Search anime to add..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        
        {suggestions.length > 0 && (
          <div className="search-suggestions animate-fade-in">
            {suggestions.map((sugg) => (
              <div 
                key={sugg.mal_id} 
                className={`suggestion-item ${isAdding === String(sugg.mal_id) ? 'is-adding' : ''}`} 
                onClick={() => handleAddAnime(sugg)}
              >
                <img src={sugg.images?.jpg?.image_url} alt="" className="sugg-img" />
                <div className="sugg-info">
                  <h4>{sugg.title}</h4>
                  <span>{sugg.year || 'N/A'} &middot; {sugg.type}</span>
                </div>
                <button className="btn-add" disabled={isAdding === String(sugg.mal_id)}>
                  {isAdding === String(sugg.mal_id) ? <RefreshCw className="spin" size={18} /> : <Plus size={18} />}
                </button>
              </div>
            ))}

          </div>
        )}
      </div>

      <div className="tabs-row">
        <div className="tabs">
          <button className={`tab-btn ${activeTab === 'watching' ? 'active' : ''}`} onClick={() => handleTabChange('watching')}>Currently Watching</button>
          <button className={`tab-btn ${activeTab === 'completed' ? 'active' : ''}`} onClick={() => handleTabChange('completed')}>Completed</button>
          <button className={`tab-btn ${activeTab === 'dropped' ? 'active' : ''}`} onClick={() => handleTabChange('dropped')}>Dropped</button>
        </div>

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
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="lists-container">
            <section className="list-section animate-fade-in">
              <h2 className="section-title">
                {activeTab === 'watching' && <><PlayCircle size={22} color="#a3b18a" /> Currently Watching</>}
                {activeTab === 'completed' && <><Check size={22} color="#a3b18a" /> Completed Anime</>}
                {activeTab === 'dropped' && <><XCircle size={22} color="#d68c8c" /> Dropped Anime</>}
              </h2>
              {renderList()}
              {renderPagination()}
            </section>
            
            <div className="dashboard-promo">
              <p>Looking for your original detailed history with numbering?</p>
              <Link href="/original-list" className="btn-link">View Original Numbered List &rarr;</Link>
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
        onClose={() => { setShowDeleteModal(false); setPendingAnime(null); }}
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
            <button className="modal-btn secondary" onClick={() => { setShowDeleteModal(false); setPendingAnime(null); }}>
              No, Keep It
            </button>
            <button className="modal-btn danger" onClick={handleConfirmDelete}>
              Delete Permanently
            </button>
          </div>
        </div>
      </Modal>

      {/* Drop Confirmation Modal */}
      <Modal
        isOpen={showDropModal}
        onClose={() => { setShowDropModal(false); setPendingAnime(null); }}
        title="Drop Anime"
      >
        <div className="move-modal-inner">
          <div className="move-modal-icon">
            <XCircle size={42} color="#d68c8c" />
          </div>
          <p>
            Move <strong>{pendingAnime?.name}</strong> to your Dropped list?
          </p>
          <p className="modal-description-sub">You can always find it in the Dropped tab later.</p>
          <div className="modal-actions">
            <button className="modal-btn secondary" onClick={() => { setShowDropModal(false); setPendingAnime(null); }}>
              No, Keep It
            </button>
            <button className="modal-btn danger" onClick={handleConfirmDrop}>
              Move to Dropped
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}

