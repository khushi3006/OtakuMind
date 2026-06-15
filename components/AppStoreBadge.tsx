interface AppStoreBadgeProps {
  /** Rendered height in px; width keeps Apple's 3:1 badge ratio. */
  height?: number;
  className?: string;
}

const APPLE_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Apple's official-style "Download on the App Store" badge, inlined as an SVG
 * so it renders crisply at any size and needs no external asset. Per Apple's
 * marketing guidelines the badge artwork is not altered (black lockup, Apple
 * glyph + "Download on the / App Store" text). The link/aria-label is supplied
 * by the wrapping anchor.
 */
export default function AppStoreBadge({ height = 48, className = '' }: AppStoreBadgeProps) {
  const width = (height * 120) / 40;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 40"
      role="img"
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect
        x="0.5"
        y="0.5"
        width="119"
        height="39"
        rx="8"
        fill="#000"
        stroke="#A6A6A6"
        strokeOpacity="0.4"
      />
      {/* Apple glyph */}
      <path
        transform="translate(9 7.5) scale(1.08)"
        fill="#fff"
        d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83zM13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"
      />
      <text
        x="42"
        y="16"
        fill="#fff"
        fontFamily={APPLE_FONT}
        fontSize="7"
        letterSpacing="0.4"
      >
        Download on the
      </text>
      <text
        x="41"
        y="31"
        fill="#fff"
        fontFamily={APPLE_FONT}
        fontSize="14.5"
        fontWeight="600"
        letterSpacing="-0.4"
      >
        App Store
      </text>
    </svg>
  );
}
