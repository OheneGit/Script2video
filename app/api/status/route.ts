import { NextRequest, NextResponse } from 'next/server'
import { getRenderStatus } from '../../lib/render'

export async function GET(req: NextRequest) {
  const renderId = req.nextUrl.searchParams.get('id')

  if (!renderId) {
    return NextResponse.json({ error: 'Missing render id.' }, { status: 400 })
  }

  try {
    const result = await getRenderStatus(renderId)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('/api/status error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
