import { useQuery } from '@tanstack/react-query';
import { apiFetch, qs } from '@/lib/api';
import { qk } from '@/lib/query/keys';

export type Anime = {
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

export type AnimePagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type AnimePage = {
  data: Anime[];
  pagination: AnimePagination;
};

export function useAnimeList(params: {
  status?: string;
  sort?: string;
  search?: string;
  page?: number;
  limit?: number;
  enabled?: boolean;
}) {
  const { status, sort, search, page = 1, limit = 20, enabled = true } = params;
  return useQuery({
    queryKey: qk.animeList(status, sort, search, page, limit),
    queryFn: () => apiFetch<AnimePage>(`/api/anime${qs({ status, sort, search, page, limit })}`),
    enabled,
    placeholderData: (prev) => prev, // keep previous page visible while the next loads (no flicker)
  });
}
