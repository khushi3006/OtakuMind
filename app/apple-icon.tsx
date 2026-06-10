import { ImageResponse } from 'next/og';

// iOS home-screen icon (apple-touch-icon), generated from the brand mark.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#faf9f6',
        }}
      >
        <svg width="132" height="132" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M15.5 5.5 C14 5.5, 12 6, 10.5 7 C9 8, 7.5 9.5, 7 11.5 C6.5 13.5, 6.5 15.5, 7 17 C7.5 18.5, 8 19, 8 19.5 C7.5 20.5, 7.5 21.5, 8.5 22.5 C9.5 23.5, 11 24, 12.5 24 C14 24, 15 24.5, 15.5 25 L15.5 5.5Z"
            fill="#3d5a3a"
          />
          <path
            d="M15.5 5.5 C17 5.5, 19 6, 20.5 7 C22 8, 23.5 9.5, 24 11.5 C24.5 13.5, 24.5 15, 24 16.5 C23.5 18, 23 18.5, 23 19 C23.5 20, 24 21, 23.5 22.5 C23 23.5, 22 24.5, 20.5 25 C19 25.5, 17 25.5, 15.5 25 L15.5 5.5Z"
            fill="#c75b7a"
          />
          <path d="M15.5 25 C15 26.5, 14 27.5, 13 28" stroke="#3d5a3a" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    ),
    size,
  );
}
