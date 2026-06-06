import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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
  // Airing/broadcast fields (present on the incomplete-list rows used by the
  // airing schedule; optional everywhere else).
  airing?: boolean;
  broadcastDay?: string | null;
  broadcastTime?: string | null;
  broadcastTimezone?: string | null;
  broadcastString?: string | null;
  airingStart?: string | null;
  nextEpisode?: number | null;
  nextEpisodeAt?: number | null;
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

/**
 * All incomplete ("Currently Watching") anime in one shot (limit 100), used by
 * the airing schedule to derive today/this-week/upcoming groupings client-side.
 */
export function useIncompleteAll() {
  return useQuery({
    queryKey: qk.incompleteAll,
    queryFn: () => apiFetch<AnimePage>(`/api/anime${qs({ status: 'incomplete', limit: 100 })}`),
    select: (d) => d.data,
  });
}

/**
 * Optimistically patch a single anime row across every cached paginated list.
 * Web lists are paginated `useQuery` results keyed by params, each holding an
 * `AnimePage` ({ data, pagination }). We also cover `useIncompleteAll` (same
 * shape). Returns [key, prevData] snapshots for rollback.
 */
function patchCachedAnime(
  queryClient: ReturnType<typeof useQueryClient>,
  id: number,
  patch: Partial<Anime>,
): [readonly unknown[], AnimePage][] {
  const queries = queryClient.getQueriesData<AnimePage>({ queryKey: ['anime'] });
  const snapshots: [readonly unknown[], AnimePage][] = [];
  for (const [key, data] of queries) {
    if (!data || !Array.isArray((data as AnimePage).data)) continue;
    snapshots.push([key, data]);
    queryClient.setQueryData<AnimePage>(key, {
      ...data,
      data: data.data.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  }
  return snapshots;
}

export type UpdateAnimeInput = {
  id: number;
  episodesWatched?: number;
  status?: string;
  name?: string;
  season?: number;
  imageUrl?: string | null;
  type?: string;
  totalEpisodes?: number;
} & Record<string, unknown>;

/**
 * Update an anime. Mirrors mobile's optimistic semantics: when `status` is
 * unchanged the row stays in its current list, so we optimistically patch every
 * cached list and roll back on error. On a status change the row moves lists, so
 * we skip the optimistic patch and rely on the on-settle invalidation. Always
 * invalidates `['anime']` + stats on settle. Reusable by the dashboard.
 */
export function useUpdateAnime() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateAnimeInput) =>
      apiFetch<Anime>(`/api/anime/${id}`, { method: 'PUT', json: patch }),
    onMutate: async ({ id, status, ...rest }) => {
      if (status !== undefined) return { snapshots: [] as [readonly unknown[], AnimePage][] };
      await queryClient.cancelQueries({ queryKey: ['anime'] });
      const snapshots = patchCachedAnime(queryClient, id, rest as Partial<Anime>);
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['anime'] });
      queryClient.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

export type CreateAnimeInput = Record<string, unknown> & { name: string };

/**
 * Create an anime (e.g. "Track this Show" from popular). Invalidates `['anime']`
 * + stats on success so the new row appears on refetch. Reusable by the dashboard.
 */
export function useCreateAnime() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAnimeInput) =>
      apiFetch<Anime>('/api/anime', { method: 'POST', json: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anime'] });
      queryClient.invalidateQueries({ queryKey: qk.stats });
    },
  });
}
