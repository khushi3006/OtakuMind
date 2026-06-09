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

export interface WebEntitlement {
  active: boolean;
  reason: 'grandfathered' | 'purchased' | 'trial' | 'expired';
  trialEndsAt: string | null;
}

type MeResponse = { user: Me; entitlement?: WebEntitlement };

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => apiFetch<MeResponse>('/api/auth/me'),
    select: (d) => d.user,
  });
}

export function useEntitlement() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => apiFetch<MeResponse>('/api/auth/me'),
    select: (d) => d.entitlement ?? null,
  });
}
