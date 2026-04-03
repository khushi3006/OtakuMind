import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    
    if (!q) return NextResponse.json({ data: [] });

    const res = await fetch(
      `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=5&sfw=true`
    );
    const json = await res.json();

    return NextResponse.json(json);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
