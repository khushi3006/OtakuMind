import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    
    if (!q) return NextResponse.json({ data: [] });

    const page = searchParams.get('page') || '1';

    const res = await fetch(
      `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=25&page=${page}&sfw=true`
    );

    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}));
      const errorMsg = errorJson.message || errorJson.error || `Jikan API returned status ${res.status}`;
      return NextResponse.json({ error: errorMsg }, { status: res.status });
    }

    const json = await res.json();
    return NextResponse.json(json);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
