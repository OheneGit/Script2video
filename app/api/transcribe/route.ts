/**
 * POST /api/transcribe
 * Transcribes an uploaded audio file using OpenAI Whisper (runs locally, free).
 * Install: pip install openai-whisper
 */

import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execAsync = promisify(exec)
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')
const TEMP_DIR   = path.join(process.cwd(), 'tmp_clips')

export async function POST(req: NextRequest) {
  try {
    const { filename } = await req.json()
    if (!filename) return NextResponse.json({ error: 'No filename provided.' }, { status: 400 })

    const audioPath = path.join(UPLOAD_DIR, filename)
    if (!fs.existsSync(audioPath)) {
      return NextResponse.json({ error: 'Audio file not found.' }, { status: 404 })
    }

    // Get duration first
    let duration = 0
    try {
      const { stdout } = await execAsync(
        `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`
      )
      duration = parseFloat(stdout.trim()) || 0
    } catch {}

    // Run Whisper transcription
    // Uses the tiny model for speed (still very accurate for English)
    const outDir = path.join(TEMP_DIR, `whisper_${Date.now()}`)
    fs.mkdirSync(outDir, { recursive: true })

    try {
      await execAsync(
        `whisper "${audioPath}" --model tiny --output_format txt --output_dir "${outDir}" --language en`,
        { timeout: 300000 } // 5 min timeout
      )

      // Find the output txt file
      const files = fs.readdirSync(outDir)
      const txtFile = files.find(f => f.endsWith('.txt'))
      if (!txtFile) throw new Error('No transcript file generated.')

      const text = fs.readFileSync(path.join(outDir, txtFile), 'utf-8').trim()

      // Cleanup
      fs.rmSync(outDir, { recursive: true, force: true })

      return NextResponse.json({ text, duration })

    } catch (whisperErr: any) {
      fs.rmSync(outDir, { recursive: true, force: true })

      // Whisper not installed — return duration only, user can paste script manually
      if (whisperErr.message?.includes('whisper') || whisperErr.message?.includes('not recognized')) {
        return NextResponse.json({
          text: '',
          duration,
          warning: 'Whisper not installed. Install with: pip install openai-whisper. You can paste your script manually.',
        })
      }
      throw whisperErr
    }

  } catch (err: any) {
    console.error('/api/transcribe error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
