import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/** A trending seasonal show from `/api/anime/popular-airing` (Jikan-shaped). */
export type PopularAnime = {
  mal_id: number;
  title: string;
  title_english: string | null;
  images: {
    jpg: {
      image_url: string | null;
    };
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

/**
 * Trending seasonal airing recommendations. Cached 15min (matches mobile) since
 * the seasonal feed changes slowly and the upstream AniList API is rate-limited.
 */
export function usePopularAiring() {
  return useQuery({
    queryKey: qk.popularAiring,
    queryFn: () => apiFetch<{ data: PopularAnime[] }>('/api/anime/popular-airing'),
    select: (d) => d.data,
    staleTime: 15 * 60_000,
  });
}
