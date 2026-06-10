import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const file = searchParams.get('file')
  if (!file) return NextResponse.json({ error: 'No file specified' }, { status: 400 })

  const filePath = path.join(process.cwd(), 'public', 'renders', path.basename(file))

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const fileBuffer = fs.readFileSync(filePath)
  return new NextResponse(fileBuffer, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="script2video.mp4"`,
      'Content-Length': fileBuffer.length.toString(),
    },
  })
}