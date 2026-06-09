import { NextRequest, NextResponse } from 'next/server'
import { submitRender } from '../../lib/render'
import type { RenderRequest } from '../../lib/types'

export async function POST(req: NextRequest) {
  try {
    const body: RenderRequest = await req.json()

    if (!body.segments || body.segments.length === 0) {
      return NextResponse.json({ error: 'No segments provided.' }, { status: 400 })
    }

    // Filter out segments with no usable clip
    const usableSegments = body.segments.filter(
      s => s.clips.length > 0 && s.clips[s.chosenIndex]?.videoUrl
    )

    if (usableSegments.length === 0) {
      return NextResponse.json(
        { error: 'No clips with video URLs found. Try different keywords or sources.' },
        { status: 422 }
      )
    }

    const result = await submitRender({ ...body, segments: usableSegments })
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('/api/render error', err)
    return NextResponse.json({ error: err.message ?? 'Unknown error' }, { status: 500 })
  }
}
