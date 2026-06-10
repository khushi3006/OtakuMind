import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';
import { SITE_URL } from '@/lib/site';

// Regenerated at most once a day; public profiles come from the DB. The DB
// read is best-effort so a connectivity hiccup (e.g. at build time) degrades
// to the static entries instead of failing the build.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/privacy`,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  try {
    const users = await db.user.findMany({
      where: { isPublic: true },
      select: { username: true },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
    for (const u of users) {
      entries.push({
        url: `${SITE_URL}/users/${u.username}`,
        changeFrequency: 'daily',
        priority: 0.7,
      });
    }
  } catch {
    // Static entries only.
  }

  return entries;
}
