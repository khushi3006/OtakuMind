import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function Logo({ size = 28, className = '', style = {} }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`brand-logo-svg ${className}`}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
        cursor: 'pointer',
        ...style,
      }}
    >
      <style>{`
        .brand-logo-svg {
          transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .brand-logo-svg:hover {
          transform: scale(1.08);
        }
        .brand-left-brain {
          transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          transform-origin: 14px 16px;
        }
        .brand-right-brain {
          transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          transform-origin: 19px 16px;
        }
        .brand-logo-svg:hover .brand-left-brain {
          transform: rotate(-2deg) translateX(-0.3px);
        }
        .brand-logo-svg:hover .brand-right-brain {
          transform: rotate(2deg) translateX(0.3px);
        }
      `}</style>

      {/* Left hemisphere — solid forest green brain shape */}
      <path
        className="brand-left-brain"
        d="M15.5 5.5
           C14 5.5, 12 6, 10.5 7
           C9 8, 7.5 9.5, 7 11.5
           C6.5 13.5, 6.5 15.5, 7 17
           C7.5 18.5, 8 19, 8 19.5
           C7.5 20.5, 7.5 21.5, 8.5 22.5
           C9.5 23.5, 11 24, 12.5 24
           C14 24, 15 24.5, 15.5 25
           L15.5 5.5Z"
        fill="#3d5a3a"
      />

      {/* Right hemisphere — solid deep pink brain shape */}
      <path
        className="brand-right-brain"
        d="M15.5 5.5
           C17 5.5, 19 6, 20.5 7
           C22 8, 23.5 9.5, 24 11.5
           C24.5 13.5, 24.5 15, 24 16.5
           C23.5 18, 23 18.5, 23 19
           C23.5 20, 24 21, 23.5 22.5
           C23 23.5, 22 24.5, 20.5 25
           C19 25.5, 17 25.5, 15.5 25
           L15.5 5.5Z"
        fill="#c75b7a"
      />

      {/* Brain folds — left side (darker green grooves) */}
      <path
        d="M7.5 14 C9.5 14.5, 12 14, 14 13"
        stroke="#2d4a2e"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M8 19.5 C10 19, 12 18, 14.5 18.5"
        stroke="#2d4a2e"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
      />

      {/* Brain folds — right side (darker pink grooves) */}
      <path
        d="M24 14 C22 14.5, 19.5 14, 17.5 13"
        stroke="#a8405a"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M23 19 C21.5 18.5, 19.5 18, 17 18.5"
        stroke="#a8405a"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
      />

      {/* Central fissure line */}
      <line
        x1="15.5" y1="5.5" x2="15.5" y2="25"
        stroke="#1a1a1a"
        strokeWidth="0.6"
        opacity="0.2"
      />

      {/* Brain stem */}
      <path
        d="M15.5 25 C15 26.5, 14 27.5, 13 28"
        stroke="#3d5a3a"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />

      {/* Small sakura accent — top right */}
      <circle cx="21" cy="9.5" r="1" fill="#a8405a" opacity="0.7" />
      <path d="M21 8.5 C20.5 7.8, 21 7.2, 21.5 7.8 C21.8 8.2, 21.4 8.5, 21 8.5Z" fill="#d88a9a" />
      <path d="M22 9.3 C22.5 8.8, 23 9.2, 22.5 9.8 C22.2 10.1, 21.8 9.7, 22 9.3Z" fill="#d88a9a" />

      {/* Small leaf accent — top left */}
      <path d="M10.5 9 C9.5 8, 9 9, 9.5 10 C10 10.5, 10.8 9.8, 10.5 9Z" fill="#2d4a2e" />
    </svg>
  );
}
