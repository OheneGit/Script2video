/**
 * POST /api/tts
 * Generates an MP3 voiceover from script text using Microsoft Edge TTS.
 * Free, no API key needed, 400+ voices available.
 */

import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import type { TTSRequest, TTSResponse } from '../../lib/types'

const execAsync = promisify(exec)
const TTS_DIR = path.join(process.cwd(), 'public', 'tts')

function ensureDir() {
  if (!fs.existsSync(TTS_DIR)) fs.mkdirSync(TTS_DIR, { recursive: true })
}

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`
    )
    return parseFloat(stdout.trim()) || 0
  } catch {
    return 0
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureDir()
    const body: TTSRequest = await req.json()
    const { text, voice, speed, pitch } = body

    if (!text || text.trim().length < 5) {
      return NextResponse.json({ error: 'No text provided.' }, { status: 400 })
    }

    const filename = `tts_${Date.now()}.mp3`
    const outPath  = path.join(TTS_DIR, filename)

    // Build SSML with speed and pitch
    const ssml = `
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
  <voice name="${voice}">
    <prosody rate="${speed}" pitch="${pitch}">
      ${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
    </prosody>
  </voice>
</speak>`.trim()

    // Use edge-tts CLI (installed via pip) or the npm package
    // Try edge-tts python CLI first (most reliable)
    const ssmlFile = path.join(TTS_DIR, `${Date.now()}_ssml.xml`)
    fs.writeFileSync(ssmlFile, ssml)

    try {
      await execAsync(
        `edge-tts --voice "${voice}" --rate="${speed}" --pitch="${pitch}" --text "${text.replace(/"/g, "'")}" --write-media "${outPath}"`,
        { timeout: 60000 }
      )
    } catch {
      // Fallback: try edge-playback or python -m edge_tts
      try {
        await execAsync(
          `python -m edge_tts --voice "${voice}" --rate="${speed}" --pitch="${pitch}" --text "${text.replace(/"/g, "'")}" --write-media "${outPath}"`,
          { timeout: 60000 }
        )
      } catch (err2: any) {
        fs.unlink(ssmlFile, () => {})
        return NextResponse.json({
          error: 'Edge TTS not installed. Run: pip install edge-tts',
          details: err2.message,
        }, { status: 500 })
      }
    }

    fs.unlink(ssmlFile, () => {})

    if (!fs.existsSync(outPath)) {
      return NextResponse.json({ error: 'TTS file was not created.' }, { status: 500 })
    }

    const duration = await getAudioDuration(outPath)

    const response: TTSResponse = {
      audioUrl:  `/tts/${filename}`,
      duration,
      filename,
    }

    return NextResponse.json(response)
  } catch (err: any) {
    console.error('/api/tts error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
