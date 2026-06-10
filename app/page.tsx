import type { Metadata } from 'next';
import { getSession } from '@/lib/auth';
import { SITE_DESCRIPTION } from '@/lib/site';
import Landing from '@/components/Landing';
import HomeDashboard from './home-client';

export const metadata: Metadata = {
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
};

// `/` is public: anonymous visitors (and crawlers) get the server-rendered
// landing page; a logged-in session gets the dashboard. The proxy no longer
// gates this route.
export default async function Home() {
  const session = await getSession();
  if (session) return <HomeDashboard />;
  return <Landing />;
}
