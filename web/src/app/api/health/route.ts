import { NextResponse } from "next/server";

// GET /api/health — makes a live request to Supabase to confirm the URL and key work.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return NextResponse.json(
      { supabase: "error", message: "Supabase env vars are not set" },
      { status: 500 },
    );
  }

  const res = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: key },
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { supabase: "error", status: res.status },
      { status: 502 },
    );
  }

  return NextResponse.json({
    supabase: "connected",
    project: new URL(url).hostname.split(".")[0],
  });
}
