export const qk = {
  me: ['me'] as const,
  stats: ['stats'] as const,
  animeList: (status?: string, sort?: string, search?: string, page?: number, limit?: number) =>
    ['anime', status ?? null, sort ?? null, search ?? '', page ?? 1, limit ?? 20] as const,
  incompleteAll: ['anime', 'incomplete', 'all'] as const,
  popularAiring: ['popular-airing'] as const,
  jikanSearch: (q: string, page?: number) => ['jikan-search', q, page ?? 1] as const,
  userSearch: (q: string) => ['user-search', q] as const,
  profile: (username: string) => ['profile', username] as const,
  userAnime: (username: string, status: string, page?: number) => ['user-anime', username, status, page ?? 1] as const,
  followers: (username: string) => ['followers', username] as const,
  following: (username: string) => ['following', username] as const,
  blocks: ['blocks'] as const,
};
