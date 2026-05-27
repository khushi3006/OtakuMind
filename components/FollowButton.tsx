"use client";

import { useState } from 'react';
import { UserPlus, UserCheck, Loader2 } from 'lucide-react';

interface FollowButtonProps {
  username: string;
  initialIsFollowing: boolean;
  size?: 'sm' | 'md';
  onChange?: (isFollowing: boolean, followersCount?: number) => void;
}

export default function FollowButton({
  username,
  initialIsFollowing,
  size = 'md',
  onChange,
}: FollowButtonProps) {
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;

    const next = !isFollowing;
    setLoading(true);
    // Optimistic flip.
    setIsFollowing(next);

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}/follow`, {
        method: next ? 'POST' : 'DELETE',
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      setIsFollowing(data.isFollowing);
      onChange?.(data.isFollowing, data.followersCount);
    } catch {
      // Revert on failure.
      setIsFollowing(!next);
    } finally {
      setLoading(false);
    }
  };

  const className = [
    'follow-btn',
    size === 'sm' ? 'follow-btn-sm' : '',
    isFollowing ? 'following' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={className}
      onClick={toggle}
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-pressed={isFollowing}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 14 : 16} className="spin" />
      ) : isFollowing ? (
        <>
          <UserCheck size={size === 'sm' ? 14 : 16} />
          <span>{hovered ? 'Unfollow' : 'Following'}</span>
        </>
      ) : (
        <>
          <UserPlus size={size === 'sm' ? 14 : 16} />
          <span>Follow</span>
        </>
      )}
    </button>
  );
}
