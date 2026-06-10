import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// All crawlers (including AI bots — LLM visibility is deliberate) may index
// the public surface: the landing page, /privacy, and /users/<handle>
// profiles. Session-gated pages just redirect to /login, but disallowing them
// keeps crawl noise down. NOTE: no `/users` disallow — robots rules are
// prefix matches, so that would block every profile page too.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/login',
        '/signup',
        '/forgot-password',
        '/reset-password',
        '/airing-schedule',
        '/original-list',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
