import { NextRequest, NextResponse } from 'next/server'

const GATEWAY =
  process.env.GATEWAY_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  'http://localhost:3000'

// Server-side secret — NEVER exposed to the browser
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''

export async function GET() {
  try {
    const res = await fetch(`${GATEWAY}/admin/keys`, {
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      cache: 'no-store',
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: 'failed_to_fetch_keys', message },
      { status: 502 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await fetch(`${GATEWAY}/admin/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: 'failed_to_create_key', message },
      { status: 502 },
    )
  }
}
