import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, qs } from '@/lib/api';
import { qk } from '@/lib/query/keys';
import { type UserCardData } from '@/components/UserCard';

export function useUserSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: qk.userSearch(q),
    queryFn: () => apiFetch<{ data: UserCardData[] }>(`/api/users/search${qs({ q })}`),
    select: (d) => d.data,
    enabled,
  });
}

export type Profile = {
  id: number;
  username: string;
  name: string | null;
  bio: string | null;
  isPublic: boolean;
  createdAt: string;
  followersCount: number;
  followingCount: number;
  isSelf: boolean;
  isFollowing: boolean;
  canViewList: boolean;
  animeCounts: { watching: number; completed: number; dropped: number; total: number };
};

export type ListAnime = {
  id: number;
  name: string;
  normalizedName: string;
  season: number;
  episodesWatched: number;
  totalEpisodes: number;
  status: string;
  imageUrl: string | null;
  malId: number | null;
  type: string;
  airing: boolean;
  inMyList: boolean;
};

export type ListAnimePage = {
  data: ListAnime[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

function enc(username: string): string {
  return encodeURIComponent(username);
}

export function useProfile(username: string) {
  return useQuery({
    queryKey: qk.profile(username),
    enabled: !!username,
    queryFn: () => apiFetch<{ profile: Profile }>(`/api/users/${enc(username)}`),
    select: (d) => d.profile,
  });
}

export function useUserAnime(
  username: string,
  status: string,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: qk.userAnime(username, status, page),
    enabled: enabled && !!username,
    queryFn: () =>
      apiFetch<ListAnimePage>(
        `/api/users/${enc(username)}/anime${qs({ status, page, limit: 20 })}`,
      ),
    placeholderData: (prev) => prev, // keep previous page visible while the next loads
  });
}

/**
 * Follow/unfollow toggle with optimistic update of the cached profile
 * (`qk.profile(username)`): flips `isFollowing` and adjusts `followersCount` by
 * ±1 in `onMutate`, rolls back on error, and invalidates the profile on settle.
 * The mutation hits the raw `{ profile }` cache shape (pre-`select`), so it patches
 * `data.profile`.
 */
export function useFollow(username: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'follow' | 'unfollow') =>
      apiFetch<{ isFollowing: boolean; followersCount: number }>(
        `/api/users/${enc(username)}/follow`,
        { method: action === 'follow' ? 'POST' : 'DELETE' },
      ),
    onMutate: async (action) => {
      const key = qk.profile(username);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<{ profile: Profile }>(key);
      if (prev?.profile) {
        const isFollowing = action === 'follow';
        queryClient.setQueryData<{ profile: Profile }>(key, {
          profile: {
            ...prev.profile,
            isFollowing,
            followersCount: Math.max(
              0,
              prev.profile.followersCount + (isFollowing ? 1 : -1),
            ),
          },
        });
      }
      return { prev };
    },
    onError: (_e, _action, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(qk.profile(username), ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.profile(username) });
      queryClient.invalidateQueries({ queryKey: ['user-search'] });
      queryClient.invalidateQueries({ queryKey: ['followers'] });
      queryClient.invalidateQueries({ queryKey: ['following'] });
    },
  });
}

export type UpdatedUser = {
  id: number;
  email: string;
  name: string | null;
  username: string;
  bio: string | null;
  isPublic: boolean;
  followersCount: number;
  followingCount: number;
};

/**
 * Edit the signed-in user's profile (PUT /api/users/me). Invalidates the cached
 * profile + session ('me') on success so the header reflects the new values.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name?: string | null;
      username?: string;
      bio?: string | null;
      isPublic?: boolean;
    }) => apiFetch<{ user: UpdatedUser }>('/api/users/me', { method: 'PUT', json: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useFollowers(username: string, enabled = true) {
  return useQuery({
    queryKey: qk.followers(username),
    enabled: enabled && !!username,
    queryFn: () =>
      apiFetch<{ data: UserCardData[] }>(`/api/users/${enc(username)}/followers`),
    select: (d) => d.data,
  });
}

export function useFollowing(username: string, enabled = true) {
  return useQuery({
    queryKey: qk.following(username),
    enabled: enabled && !!username,
    queryFn: () =>
      apiFetch<{ data: UserCardData[] }>(`/api/users/${enc(username)}/following`),
    select: (d) => d.data,
  });
}
