import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getPublicProfile } from '@/lib/public-profile';
import { SITE_NAME } from '@/lib/site';
import ProfileClient from './profile-client';
import PublicProfileView from './public-view';

// Profile pages are public: logged-in users get the interactive client
// experience (unchanged), anonymous visitors and crawlers get a read-only
// server-rendered view of public profiles. Private profiles render a locked
// notice and are noindexed.

type Props = { params: Promise<{ username: string }> };

function normalizeHandle(raw: string): string {
  return decodeURIComponent(raw).trim().toLowerCase();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const handle = normalizeHandle(username);
  const profile = await getPublicProfile(handle);

  if (!profile) {
    return { title: 'User not found', robots: { index: false, follow: false } };
  }

  const display = profile.name || `@${profile.username}`;
  const title = `${display} (@${profile.username}) — Anime List`;

  if (!profile.isPublic) {
    return { title, robots: { index: false, follow: false } };
  }

  const path = `/users/${profile.username}`;
  const description = `${display} is tracking ${profile.counts.total} anime on ${SITE_NAME} — ${profile.counts.watching} watching, ${profile.counts.completed} completed. Follow @${profile.username} to browse their full list.`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'profile',
      siteName: SITE_NAME,
      title: `${title} · ${SITE_NAME}`,
      description,
      url: path,
      images: [{ url: '/og', width: 1200, height: 630, alt: `${SITE_NAME} profile of ${display}` }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} · ${SITE_NAME}`,
      description,
      images: ['/og'],
    },
  };
}

export default async function ProfilePage({ params }: Props) {
  const session = await getSession();
  if (session) return <ProfileClient />;

  const { username } = await params;
  const profile = await getPublicProfile(normalizeHandle(username));
  if (!profile) notFound();

  return <PublicProfileView profile={profile} />;
}
