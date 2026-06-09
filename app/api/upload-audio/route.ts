import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execAsync = promisify(exec)
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')

function ensureDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`
    )
    const dur = parseFloat(stdout.trim())
    if (dur && dur > 0) return dur
    // fallback: get file size and estimate duration
    const stats = fs.statSync(filePath)
    return Math.round(stats.size / 16000) // rough estimate for MP3
  } catch {
    try {
      const stats = fs.statSync(filePath)
      return Math.round(stats.size / 16000)
    } catch { return 0 }
  }
}
export async function POST(req: NextRequest) {
  try {
    ensureDir()

    // Clear ALL old uploads
    try {
      fs.readdirSync(UPLOAD_DIR).forEach(f => {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, f)) } catch {}
      })
    } catch {}

    const formData = await req.formData()
    const file = formData.get('audio') as File | null
    if (!file) return NextResponse.json({ error: 'No audio file.' }, { status: 400 })

    const ext = file.name.split('.').pop() || 'mp3'
    const filename = `upload_${Date.now()}.${ext}`
    const outPath = path.join(UPLOAD_DIR, filename)

    const buffer = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(outPath, buffer)

    const duration = await getAudioDuration(outPath)
    console.log(`Uploaded: ${file.name} | Duration: ${duration}s | File: ${filename}`)

    return NextResponse.json({
      audioUrl: `/uploads/${filename}`,
      filename,
      duration,
      originalName: file.name,
      timestamp: Date.now(),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
