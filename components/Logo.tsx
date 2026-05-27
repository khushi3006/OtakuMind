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
        .brand-logo-petal {
          transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          transform-origin: 19.3px 12.7px;
        }
        .brand-logo-svg:hover .brand-logo-petal {
          transform: translate(19.3px, 12.7px) rotate(55deg) scale(1.05);
        }
      `}</style>

      {/* Sleek black/dark-charcoal rounded square container */}
      <rect x="2" y="2" width="28" height="28" rx="6.5" fill="#121212" />
      
      {/* OtakuMind Pink Brand Symbol */}
      <g stroke="#ff2a85" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* The 'O' circle */}
        <circle cx="14.5" cy="17.5" r="6.8" />
        
        {/* The cleft Sakura Petal pointing top-right */}
        <g className="brand-logo-petal" transform="translate(19.3, 12.7) rotate(45)">
          <path d="M 0 0 C -3.5 -2.5 -4.5 -6.5 -2.5 -9 C -1.5 -8 -0.5 -7 0 -6.5 C 0.5 -7 1.5 -8 2.5 -9 C 4.5 -6.5 3.5 -2.5 0 0" />
        </g>
      </g>
    </svg>
  );
}

