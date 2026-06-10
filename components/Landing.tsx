import Link from 'next/link';
import Logo from '@/components/Logo';
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from '@/lib/site';

// Server-rendered marketing page shown to anonymous visitors at `/`.
// Crawlers and LLM agents don't execute JS, so everything here must be
// real HTML: full sentences, semantic headings, plain links.
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/icon.svg`,
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
    {
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      url: SITE_URL,
      applicationCategory: 'EntertainmentApplication',
      operatingSystem: 'Web, iOS',
      description: SITE_DESCRIPTION,
      offers: {
        '@type': 'Offer',
        price: '299',
        priceCurrency: 'INR',
        description: 'One-time lifetime unlock after a 14-day free trial. No subscription.',
      },
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
  ],
};

export default function Landing() {
  return (
    <main className="landing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <section className="landing-hero">
        <Logo size={56} />
        <h1>
          Every anime you&rsquo;ve watched.
          <br />
          One quiet, organized place.
        </h1>
        <p className="landing-lede">
          OtakuMind is a minimalist anime tracker. Log what you&rsquo;re watching, group whole
          franchises under a single name, follow a live airing schedule with real episode
          countdowns, and share your list with friends &mdash; without ads, clutter, or noise.
        </p>
        <div className="landing-cta-row">
          <Link href="/signup" className="landing-cta-primary">
            Start tracking &mdash; free for 14 days
          </Link>
          <Link href="/login" className="landing-cta-secondary">
            Log in
          </Link>
        </div>
      </section>

      <section className="landing-features" aria-label="Features">
        <div className="landing-feature">
          <h2>Track franchises, not fragments</h2>
          <p>
            &ldquo;Attack on Titan&rdquo;, &ldquo;Attack on Titan Season 2&rdquo;, and
            &ldquo;Attack on Titan: Final Season&rdquo; are one show. OtakuMind normalizes titles
            so every season, movie, and OVA collapses under a single franchise &mdash; and your
            unique-anime count finally means something.
          </p>
        </div>
        <div className="landing-feature">
          <h2>A real airing schedule</h2>
          <p>
            See exactly which episode airs next and a live countdown to it, sourced from official
            broadcast data &mdash; not a guess. Your weekly schedule shows only the shows you are
            actually watching.
          </p>
        </div>
        <div className="landing-feature">
          <h2>Watching, completed, dropped</h2>
          <p>
            Three honest lists. Reorder your currently-watching queue by drag and drop, tick off
            episodes as you go, and keep a permanent record of everything you have finished or
            abandoned.
          </p>
        </div>
        <div className="landing-feature">
          <h2>Follow your friends</h2>
          <p>
            Every account has a public profile and handle. Follow people, browse their lists, and
            copy any anime straight into your own watching queue. Private profiles stay private.
          </p>
        </div>
        <div className="landing-feature">
          <h2>Your data is yours</h2>
          <p>
            Export your entire list to Excel at any time. No lock-in, no dark patterns &mdash; and
            a <Link href="/privacy">privacy policy</Link> you can actually read.
          </p>
        </div>
        <div className="landing-feature">
          <h2>On the web and iPhone</h2>
          <p>
            OtakuMind runs in any browser, and a native iOS app keeps your lists and airing
            countdowns in your pocket. One account, both places.
          </p>
        </div>
      </section>

      <section className="landing-pricing" aria-label="Pricing">
        <h2>Pay once. That&rsquo;s it.</h2>
        <p>
          Try everything free for 14 days. Then a single payment of <strong>&#8377;299</strong>{' '}
          unlocks OtakuMind for life &mdash; no subscription, no recurring charges.
        </p>
        <Link href="/signup" className="landing-cta-primary">
          Create your account
        </Link>
      </section>
    </main>
  );
}
