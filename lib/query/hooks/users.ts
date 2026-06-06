import { useQuery } from '@tanstack/react-query';
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
