/**
 * Canonical site identity used by metadata, sitemap/robots, and structured data.
 * APP_URL is the same env var the email templates use for absolute links.
 */
export const SITE_URL = (process.env.APP_URL || 'https://otakumind.thekhushikumari.com').replace(/\/+$/, '');
export const SITE_NAME = 'OtakuMind';
export const SITE_TAGLINE = 'Minimalist Anime Tracker';
export const SITE_DESCRIPTION =
  'OtakuMind is a minimalist anime tracker. Log every anime you watch, group seasons under one franchise, follow a live airing schedule with real episode countdowns, and share your list with friends.';
