/**
 * Local render script — run this on your PC for long videos
 *
 * Usage:
 *   node render-local.mjs project_1234567890.json
 *
 * Requirements:
 *   - Node.js 18+
 *   - ffmpeg installed and in PATH
 *
 * The script will:
 *   1. Download all video clips
 *   2. Download your audio file from Railway
 *   3. Run FFmpeg to stitch everything together
 *   4. Save the final MP4 in the current folder
 */

import fs   from 'fs'
import path from 'path'
import https from 'https'
import http  from 'http'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ── Helpers ──────────────────────────────────────────────────────

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    // Handle relative URLs (prepend serverBase)
    if (url.startsWith('/')) {
      url = `${PROJECT.serverBase}${url}`
    }
    const file = fs.createWriteStream(destPath)
    const protocol = url.startsWith('https') ? https : http
    const req = protocol.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        file.close()
        reject(new Error(`Download failed ${res.statusCode}: ${url}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    })
    req.on('error', err => { fs.unlink(destPath, ()=>{}) ; reject(err) })
    req.setTimeout(60000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)) })
  })
}

function fmtTime(ms) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s/60)}m${s%60}s`
}

// ── Main ─────────────────────────────────────────────────────────

const projectFile = process.argv[2]
if (!projectFile) {
  console.error('Usage: node render-local.mjs <project.json>')
  process.exit(1)
}

const PROJECT = JSON.parse(fs.readFileSync(projectFile, 'utf-8'))
const { segments, audioMode, audioFile, audioUrl, transition, addCaptions, captionStyle, resolution } = PROJECT

const TEMP = path.join(process.cwd(), `tmp_local_${Date.now()}`)
fs.mkdirSync(TEMP, { recursive: true })

const OUTPUT = path.join(process.cwd(), `render_${Date.now()}.mp4`)

console.log(`\n🎬 Local render started`)
console.log(`   Scenes  : ${segments.length}`)
console.log(`   Duration: ${segments.reduce((a,s)=>a+s.duration,0)}s`)
console.log(`   Output  : ${OUTPUT}\n`)

const start = Date.now()

// ── Step 1: Process each segment ─────────────────────────────────

const usable = segments.filter(s => s.clips.length > 0 && s.clips[s.chosenIndex]?.videoUrl)
const trimmedPaths = []

for (let i = 0; i < usable.length; i++) {
  const seg  = usable[i]
  const clip = seg.clips[seg.chosenIndex]
  const d    = seg.duration

  process.stdout.write(`   [${i+1}/${usable.length}] Downloading clip... `)

  const rawPath     = path.join(TEMP, `${i}_raw.mp4`)
  const trimmedPath = path.join(TEMP, `${i}_trim.mp4`)

  try {
    await downloadFile(clip.videoUrl, rawPath)
    process.stdout.write(`trimming to ${d}s... `)

    let vf = `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1`
    if (transition === 'fade') {
      vf += `,fade=t=in:st=0:d=0.3,fade=t=out:st=${Math.max(0,d-0.3)}:d=0.3`
    }

    await execAsync(
      `ffmpeg -y -i "${rawPath}" -ss 0 -t ${d} -vf "${vf}" -c:v libx264 -preset fast -crf 23 -an -r 25 -pix_fmt yuv420p "${trimmedPath}"`,
      { timeout: 120000 }
    )
    fs.unlinkSync(rawPath)
    trimmedPaths.push(trimmedPath)
    console.log('✓')
  } catch (err) {
    console.log(`✗ skipped (${err.message})`)
    try { fs.unlinkSync(rawPath) } catch {}
  }
}

if (trimmedPaths.length === 0) {
  console.error('No clips processed. Aborting.')
  process.exit(1)
}

// ── Step 2: Concatenate ───────────────────────────────────────────

console.log(`\n   Concatenating ${trimmedPaths.length} clips...`)
const listFile   = path.join(TEMP, 'list.txt')
const concatFile = path.join(TEMP, 'concat.mp4')

fs.writeFileSync(listFile, trimmedPaths.map(p => `file '${p}'`).join('\n'))
await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${concatFile}"`, { timeout: 3600000 })
trimmedPaths.forEach(p => { try { fs.unlinkSync(p) } catch {} })

// ── Step 3: Download audio ────────────────────────────────────────

let audioPath = ''
if (audioMode !== 'none' && audioUrl) {
  console.log(`   Downloading audio...`)
  const audioExt  = (audioFile || 'audio.mp3').split('.').pop()
  audioPath = path.join(TEMP, `audio.${audioExt}`)
  try {
    await downloadFile(audioUrl, audioPath)
    console.log(`   Audio downloaded ✓`)
  } catch (err) {
    console.warn(`   Audio download failed: ${err.message} — rendering without audio`)
    audioPath = ''
  }
}

// ── Step 4: Final mix ────────────────────────────────────────────

console.log(`   Final encode...`)

const totalDuration = usable.reduce((a, s) => a + s.duration, 0)
let vfArgs = ''
if (addCaptions && captionStyle) {
  const captionText = usable.map(s => s.text.replace(/^↳\s*/, '')).join(' ').slice(0, 200)
  const safeText = captionText.replace(/'/g, '’').replace(/:/g, '\\:').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
  const y = captionStyle.position === 'top' ? '50' : captionStyle.position === 'center' ? '(h-text_h)/2' : 'h-text_h-60'
  vfArgs = `-vf "drawtext=text='${safeText}':fontsize=${captionStyle.fontSize}:fontcolor=${captionStyle.color}:x=(w-text_w)/2:y=${y}:borderw=3:enable='between(t,0,${totalDuration})'"`
}

const voiceExists = audioPath && fs.existsSync(audioPath)
const inputs    = voiceExists ? `-i "${concatFile}" -i "${audioPath}"` : `-i "${concatFile}"`
const mapArgs   = voiceExists ? '-map 0:v -map 1:a' : '-map 0:v'
const audioArgs = voiceExists ? '-c:a aac -b:a 128k -shortest' : '-an'

await execAsync(
  `ffmpeg -y ${inputs} ${mapArgs} ${vfArgs} -c:v copy ${audioArgs} "${OUTPUT}"`,
  { timeout: 3600000 }
)

// ── Cleanup ───────────────────────────────────────────────────────

try { fs.unlinkSync(concatFile) } catch {}
try { if (audioPath) fs.unlinkSync(audioPath) } catch {}
try { fs.rmdirSync(TEMP) } catch {}

const elapsed = fmtTime(Date.now() - start)
console.log(`\n✅ Done in ${elapsed}`)
console.log(`   Saved to: ${OUTPUT}\n`)
