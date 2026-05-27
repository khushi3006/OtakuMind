"use client";

import Link from 'next/link';
import { Lock } from 'lucide-react';
import FollowButton from './FollowButton';

export interface UserCardData {
  id: number;
  username: string;
  name: string | null;
  bio?: string | null;
  isPublic: boolean;
  followersCount?: number;
  animeCount?: number;
  isFollowing: boolean;
  isSelf?: boolean;
}

function initials(name: string | null, username: string) {
  if (name && name.trim()) {
    return name.trim().split(/\s+/).map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  }
  return username.slice(0, 2).toUpperCase();
}

export default function UserCard({ user }: { user: UserCardData }) {
  return (
    <div className="user-card">
      {/* Link covers only the avatar + info so the follow button stays a valid sibling. */}
      <Link href={`/users/${user.username}`} className="user-card-link">
        <span className="user-card-avatar">{initials(user.name, user.username)}</span>

        <div className="user-card-info">
          <div className="user-card-name-row">
            <span className="user-card-name">{user.name || user.username}</span>
            {!user.isPublic && <Lock size={13} className="user-card-lock" />}
          </div>
          <span className="user-card-handle">@{user.username}</span>
          {user.bio ? (
            <p className="user-card-bio">{user.bio}</p>
          ) : (
            <p className="user-card-meta">
              {typeof user.followersCount === 'number' && (
                <span>{user.followersCount} {user.followersCount === 1 ? 'follower' : 'followers'}</span>
              )}
              {typeof user.animeCount === 'number' && (
                <span>&middot; {user.animeCount} anime</span>
              )}
            </p>
          )}
        </div>
      </Link>

      {!user.isSelf && (
        <div className="user-card-action">
          <FollowButton username={user.username} initialIsFollowing={user.isFollowing} size="sm" />
        </div>
      )}
    </div>
  );
}
