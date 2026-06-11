import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const UPLOAD_DIR = process.env.UPLOAD_DIR
  || path.join(process.cwd(), 'public', 'uploads')

export async function GET(
  _req: NextRequest,
  { params }: { params: { filename: string } }
) {
  const filename = path.basename(params.filename) // prevent path traversal
  const filePath = path.join(UPLOAD_DIR, filename)

  if (!fs.existsSync(filePath)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? 'mp3'
  const mime: Record<string, string> = {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
    ogg: 'audio/ogg', aac: 'audio/aac', webm: 'audio/webm',
  }
  const contentType = mime[ext] ?? 'audio/mpeg'

  const buffer = fs.readFileSync(filePath)
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
