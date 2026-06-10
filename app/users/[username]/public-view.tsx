import Link from 'next/link';
import { Lock } from 'lucide-react';
import { formatSeasonText } from '@/lib/season-format';
import { SITE_URL, SITE_NAME } from '@/lib/site';
import type { PublicAnime, PublicProfile } from '@/lib/public-profile';

// Read-only profile served to anonymous visitors (and crawlers/LLM agents,
// which don't execute JS). Logged-in users get the interactive profile-client
// instead — see page.tsx.

function initials(name: string | null, username: string) {
  if (name && name.trim()) {
    return name.trim().split(/\s+/).map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  }
  return username.slice(0, 2).toUpperCase();
}

function Section({ title, total, animes }: { title: string; total: number; animes: PublicAnime[] }) {
  if (total === 0) return null;
  const remaining = total - animes.length;
  return (
    <section className="list-section">
      <h2 className="public-list-heading">
        {title} ({total})
      </h2>
      <div className="anime-poster-grid">
        {animes.map((a) => (
          <div key={a.id} className="poster-card">
            <div className="poster-img-wrap">
              {a.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.imageUrl} alt={`${a.name} poster`} className="poster-img" loading="lazy" />
              ) : (
                <div className="poster-img poster-placeholder" />
              )}
            </div>
            <div className="poster-info">
              <span className="poster-title" title={a.name}>{a.name}</span>
              <span className="poster-meta">
                {formatSeasonText(a.season, a.part, a.type)}
                {a.type !== 'Movie' && a.totalEpisodes > 0 && (
                  <> &middot; {a.episodesWatched}/{a.totalEpisodes} ep</>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
      {remaining > 0 && (
        <p className="public-list-more">
          + {remaining} more &mdash; <Link href="/signup">create a free account</Link> to see the
          full list.
        </p>
      )}
    </section>
  );
}

export default function PublicProfileView({ profile }: { profile: PublicProfile }) {
  const display = profile.name || `@${profile.username}`;
  const url = `${SITE_URL}/users/${profile.username}`;

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    dateCreated: profile.createdAt.toISOString(),
    url,
    mainEntity: {
      '@type': 'Person',
      name: display,
      alternateName: `@${profile.username}`,
      identifier: profile.username,
      url,
      ...(profile.bio ? { description: profile.bio } : {}),
      interactionStatistic: {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/FollowAction',
        userInteractionCount: profile.followersCount,
      },
    },
  };

  return (
    <main className="dashboard">
      {profile.isPublic && (
        <script
          type="application/ld+json"
          // Bio/name are user-controlled: escape `<` so a crafted value can't
          // close the script tag (JSON.stringify alone doesn't prevent that).
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
          }}
        />
      )}

      <div className="profile-header-card">
        <span className="profile-avatar">{initials(profile.name, profile.username)}</span>
        <div className="profile-meta">
          <div className="profile-name-row">
            <h1>{display}</h1>
            {!profile.isPublic && (
              <span className="profile-private-pill"><Lock size={12} /> Private</span>
            )}
          </div>
          <span className="profile-handle">@{profile.username}</span>
          {profile.isPublic && profile.bio && <p className="profile-bio">{profile.bio}</p>}
          <div className="profile-stats">
            <span className="profile-stat static">
              <strong>{profile.followersCount}</strong> Followers
            </span>
            <span className="profile-stat static">
              <strong>{profile.followingCount}</strong> Following
            </span>
            {profile.isPublic && (
              <span className="profile-stat static">
                <strong>{profile.counts.total}</strong> Anime
              </span>
            )}
          </div>
        </div>
      </div>

      {!profile.isPublic || !profile.lists ? (
        <div className="profile-locked">
          <Lock size={40} color="#a3b18a" />
          <h3>This account is private</h3>
          <p>{display} keeps their anime list private.</p>
        </div>
      ) : (
        <>
          <Section title="Currently watching" total={profile.counts.watching} animes={profile.lists.watching} />
          <Section title="Completed" total={profile.counts.completed} animes={profile.lists.completed} />
          <Section title="Dropped" total={profile.counts.dropped} animes={profile.lists.dropped} />
          {profile.counts.total === 0 && <p className="empty-state">Nothing here yet.</p>}
        </>
      )}

      <div className="public-profile-cta">
        <p>
          This is {display}&rsquo;s anime list on {SITE_NAME}, a minimalist anime tracker. Create
          an account to follow {profile.name ? display : 'them'}, copy anime into your own list,
          and track everything you watch.
        </p>
        <div className="landing-cta-row" style={{ marginTop: '0.25rem' }}>
          <Link href="/signup" className="landing-cta-primary">Join {SITE_NAME} free</Link>
          <Link href="/login" className="landing-cta-secondary">Log in</Link>
        </div>
      </div>
    </main>
  );
}
