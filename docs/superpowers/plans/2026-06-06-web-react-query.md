# Web → React Query (Incremental) — Design & Plan

**Date:** 2026-06-06
**Status:** Approved (incremental; build+tsc verification)
**Repo:** `OtakuMind` (web), commits authored by khushi. Backend/API unchanged.

## Problem

The web client uses raw `fetch` + `useState`/`useEffect` with manual loading state.
Consequences (from the efficiency audit): `/api/anime` is re-fetched 4–5× on
interaction, `/api/stats` is re-fetched after every mutation, there's no request
dedup or caching, and each page re-implements an auth-check + loading boilerplate.
Mobile already uses TanStack Query with caching, dedup, and optimistic updates; the
web has none, so the two clients behave differently.

## Goal

Move the web client's data layer to **TanStack Query v5** (the library mobile uses),
so reads are cached/deduped/invalidated consistently and mutations update the cache
optimistically — matching mobile's *behavior* (not its exact hook code, since web
uses page-based pagination, not infinite scroll). Done **incrementally**, page by
page, in separately-reviewed commits, smallest pages first and the 1,563-line
dashboard last.

## Constraints / non-goals

- **No API/contract changes.** Backend stays as-is.
- **Preserve every page's existing UX exactly** — pagination controls, optimistic
  drag-reorder (no flicker), two-tier search, modals, skeletons, redirects.
- **Verification is build + tsc + code review only** (no browser run). Because UX
  regressions can't be caught by tsc, each page migration must be a faithful
  behavior-preserving swap, reviewed carefully. The user will manually test,
  especially the dashboard.
- React 19.2 / Next 16.2 → TanStack Query v5 (React 19 compatible). Match mobile's
  `@tanstack/react-query@^5.101.0`.

## Infrastructure (Task 1)

- **Dependency:** add `@tanstack/react-query@^5.101.0`; `npm install`.
- **`lib/query/query-client.ts`** — `makeQueryClient()` factory mirroring mobile's
  `lib/query.ts` defaults:
  ```ts
  import { QueryClient } from '@tanstack/react-query';
  import { ApiError } from '@/lib/api';
  export function makeQueryClient() {
    return new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          gcTime: 5 * 60_000,
          refetchOnWindowFocus: false,
          retry: (count, err) => {
            if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
            return count < 2;
          },
        },
        mutations: { retry: false },
      },
    });
  }
  ```
- **`components/QueryProvider.tsx`** (`"use client"`) — stable client per mount:
  ```tsx
  'use client';
  import { QueryClientProvider } from '@tanstack/react-query';
  import { useState } from 'react';
  import { makeQueryClient } from '@/lib/query/query-client';
  export default function QueryProvider({ children }: { children: React.ReactNode }) {
    const [client] = useState(makeQueryClient);
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  ```
- **`app/layout.tsx`** — wrap `<Navbar/> {children} <Footer/>` inside `<QueryProvider>`
  so every client component (incl. Navbar) can use hooks.
- **`lib/api.ts`** — a small same-origin fetch wrapper + error type + query-string
  helper:
  ```ts
  export class ApiError extends Error {
    status: number; code?: string; body?: unknown;
    constructor(status: number, message: string, code?: string, body?: unknown) {
      super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.body = body;
    }
  }
  export async function apiFetch<T>(path: string, opts: { method?: string; json?: unknown } = {}): Promise<T> {
    const res = await fetch(path, {
      method: opts.method ?? 'GET',
      headers: opts.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, body?.error ?? res.statusText, body?.type, body);
    return body as T;
  }
  export function qs(params: Record<string, string | number | undefined | null>): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
    const s = p.toString(); return s ? `?${s}` : '';
  }
  ```
- **`lib/query/keys.ts`** — keys mirroring mobile's `qk` (so invalidation parity):
  ```ts
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
  };
  ```
  All anime queries live under the `['anime']` prefix so a single
  `invalidateQueries({ queryKey: ['anime'] })` reconciles every list after a mutation.
- **Hooks** are created **per page, as each page is migrated** (not all upfront), in
  `lib/query/hooks/*.ts`, using the keys above. Web list hooks are paginated
  `useQuery` (keyed by page), NOT `useInfiniteQuery`.

## Per-page migration tasks

Each task: read the page's current fetches, replace with RQ hooks (new hooks added
as needed), **preserve all UX/markup/behavior**, `npm run build` + `npx tsc --noEmit`
pass, commit. Order (smallest/lowest-risk first):

- **Task 2 — `app/users/page.tsx`** (Discover, 113 lines): `useMe()` (auth gate +
  redirect on 401), `useUserSearch(debounced)`. Keep the 300ms debounce + skeleton.
- **Task 3 — `app/original-list/page.tsx`** (274 lines): `useAnimeList({status:'completed', page, search})` paginated; keep the two-tier (client filter → server search) behavior.
- **Task 4 — `app/airing-schedule/page.tsx`** (619 lines): `useIncompleteAll()`,
  `usePopularAiring()`, `useUpdateAnime()` (episode progress), `useCreateAnime()`
  (add from popular). Keep countdowns/IST display.
- **Task 5 — `app/users/[username]/page.tsx`** (506 lines): `useProfile(username)`,
  `useUserAnime(username, status, page)`, `useFollow()` (optimistic toggle),
  followers/following queries. Preserve visibility/inMyList rendering.
- **Task 6 — `app/page.tsx`** (dashboard, 1,563 lines — highest risk, do last):
  `useAnimeList` (paginated, per tab), `useStats`, `useJikanSearch` (add-anime
  search), `useCreateAnime`/`useUpdateAnime`/`useDeleteAnime`/`useReorderAnime` with
  the SAME optimistic semantics as mobile (`useReorderAnime` must mark stale WITHOUT
  refetch to avoid drag flicker; `useUpdateAnime` optimistic only when status
  unchanged). Export stays a direct `fetch` (file download, not RQ). Migrate
  carefully, preserving the drag-and-drop and modal flows verbatim.
- **Task 7 — `components/Navbar.tsx`** (optional): replace the `/api/auth/me`
  per-navigation poll with `useMe()` so it shares the cached session.

## Mutation semantics to preserve (parity with mobile)

- **Create:** invalidate `['anime']` + `qk.stats` on success (web shows new row on
  refetch; the dashboard may keep its existing optimistic insert if present).
- **Update:** optimistic patch across cached lists when status is unchanged; on
  status change, invalidate (row moves lists). Roll back on error.
- **Delete:** optimistic removal; roll back on error; invalidate on settle.
- **Reorder:** persist, then `invalidateQueries({ queryKey:['anime'], refetchType:'none' })`
  — never refetch on drop (prevents the row-remount flicker mobile specifically avoids).
- **Follow/unfollow:** optimistic toggle of the profile's follow state + counts.

## Verification per task

- `npx tsc --noEmit` → PASS.
- `npm run build` → PASS (route compiles, no unused-var/ref errors).
- Code review: confirm the migrated page renders the same markup, same loading
  states, same pagination/search/optimistic behavior; no leftover dead state/fetch.

## Rollout

All commits to `main` (khushi), pushed after each reviewed task. No DB/contract
changes. The user manually tests the live site, prioritizing the dashboard
(drag-reorder, add/edit/delete, tab pagination).
