import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { qk } from '@/lib/query/keys';

export interface Me {
  id: string;
  email: string;
  name: string | null;
  username: string;
  bio: string | null;
  isPublic: boolean;
  followersCount: number;
  followingCount: number;
}

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => apiFetch<{ user: Me }>('/api/auth/me'),
    select: (d) => d.user,
  });
}
