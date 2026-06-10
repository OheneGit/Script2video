/**
 * Fast Free Local Render Pipeline — FFmpeg
 * - Parallel clip downloads (10 at a time)
 * - Faster FFmpeg preset
 * - Lower CRF for faster encode
 * - Batch processing
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import type { RenderRequest, RenderResponse, ScriptSegment, CaptionStyle } from './types'

const execAsync = promisify(exec)
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'renders')
const TEMP_DIR   = path.join(process.cwd(), 'tmp_clips')
const JOBS_FILE  = path.join(process.cwd(), 'tmp_clips', 'jobs.json')

function loadJobs(): Map<string, RenderResponse> {
  try {
    if (!fs.existsSync(path.dirname(JOBS_FILE))) fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true })
    if (fs.existsSync(JOBS_FILE)) {
      return new Map(Object.entries(JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))))
    }
  } catch {}
  return new Map()
}

function saveJobs(jobs: Map<string, RenderResponse>) {
  try { fs.writeFileSync(JOBS_FILE, JSON.stringify(Object.fromEntries(jobs))) } catch {}
}

const jobs = loadJobs()

function ensureDirs() {
  [OUTPUT_DIR, TEMP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }) })
}

async function checkFFmpeg(): Promise<boolean> {
  try { await execAsync('ffmpeg -version'); return true } catch { return false }
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Handle local files (YouTube CC clips served from /yt_cache/)
    if (url.startsWith('/')) {
      const localPath = path.join(process.cwd(), 'public', url)
      if (fs.existsSync(localPath)) {
        fs.copyFileSync(localPath, destPath)
        resolve()
        return
      }
      reject(new Error(`Local file not found: ${localPath}`))
      return
    }

    const file = fs.createWriteStream(destPath)
    const protocol = url.startsWith('https') ? https : http
    const request = protocol.get(url, response => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close()
        downloadFile(response.headers.location!, destPath).then(resolve).catch(reject)
        return
      }
      if (response.statusCode !== 200) {
        file.close()
        reject(new Error(`Download failed: ${response.statusCode}`))
        return
      }
      response.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    })
    request.on('error', err => { fs.unlink(destPath, () => {}); reject(err) })
    request.setTimeout(30000, () => { request.destroy(); reject(new Error('Timeout')) })
  })
}

async function processSegment(
  seg: ScriptSegment, index: number, jobId: string, transition: string
): Promise<string | null> {
  const clip = seg.clips[seg.chosenIndex]
  if (!clip?.videoUrl) return null

  const rawPath     = path.join(TEMP_DIR, `${jobId}_${index}_raw.mp4`)
  const trimmedPath = path.join(TEMP_DIR, `${jobId}_${index}_trim.mp4`)

  try {
    await downloadFile(clip.videoUrl, rawPath)
    const d = seg.duration

    let vf = `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1`
    if (transition === 'fade') {
      vf += `,fade=t=in:st=0:d=0.3,fade=t=out:st=${Math.max(0, d - 0.3)}:d=0.3`
    }

    // ultrafast preset for speed, higher CRF (28) for smaller file/faster encode
    await execAsync(
      `ffmpeg -y -i "${rawPath}" -ss 0 -t ${d} -vf "${vf}" ` +
      `-c:v libx264 -preset ultrafast -crf 28 -an -r 25 -pix_fmt yuv420p "${trimmedPath}"`,
      { timeout: 60000 }
    )
    fs.unlink(rawPath, () => {})
    return trimmedPath
  } catch (err) {
    console.error(`Segment ${index} failed:`, err)
    fs.unlink(rawPath, () => {})
    fs.unlink(trimmedPath, () => {})
    return null
  }
}

function buildCaptionFilter(text: string, style: CaptionStyle, totalDuration: number): string {
  const safeText = text.replace(/'/g, "\u2019").replace(/:/g, '\\:').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
  const y = style.position === 'top' ? '50' : style.position === 'center' ? '(h-text_h)/2' : 'h-text_h-60'
  let borderw = '0', shadowx = '0', shadowy = '0', boxFlag = '0', boxColor = 'black@0.5'
  if (style.style === 'outline') borderw = '3'
  if (style.style === 'shadow')  { shadowx = '3'; shadowy = '3' }
  if (style.style === 'box')     { boxFlag = '1'; boxColor = `${style.bgColor}@0.7` }
  if (style.style === 'bold')    borderw = '2'
  return `drawtext=text='${safeText}':fontsize=${style.fontSize}:fontcolor=${style.color}:x=(w-text_w)/2:y=${y}:borderw=${borderw}:shadowx=${shadowx}:shadowy=${shadowy}:box=${boxFlag}:boxcolor=${boxColor}:boxborderw=10:enable='between(t,0,${totalDuration})'`
}

async function runRender(jobId: string, req: RenderRequest) {
  ensureDirs()
  const updateJob = (u: Partial<RenderResponse>) => {
    jobs.set(jobId, { ...jobs.get(jobId)!, ...u })
    saveJobs(jobs)
  }

  try {
    if (!(await checkFFmpeg())) {
      updateJob({ status: 'failed', error: 'FFmpeg not found.' })
      return
    }

    updateJob({ status: 'fetching', progress: 2, progressLabel: 'Starting...' })

    const usable = req.segments.filter(s => s.clips.length > 0 && s.clips[s.chosenIndex]?.videoUrl)
    const total  = usable.length

    // Download and process in parallel batches of 10 (faster!)
    const BATCH = 3
    const trimmedPaths: string[] = []

    for (let i = 0; i < total; i += BATCH) {
      updateJob({
        status: 'rendering',
        progress: Math.round(5 + (i / total) * 70),
        progressLabel: `Processing clips ${i + 1}–${Math.min(i + BATCH, total)} of ${total}...`,
      })
      const batch = usable.slice(i, i + BATCH)
      for (const seg of batch) {
  	const result = await processSegment(seg, batch.indexOf(seg) + i, jobId, req.transition)
  	if (result) trimmedPaths.push(result)
	}
    }

    if (trimmedPaths.length === 0) {
      updateJob({ status: 'failed', error: 'No clips could be processed.' })
      return
    }

    updateJob({ status: 'rendering', progress: 76, progressLabel: 'Concatenating clips...' })

    const listFile   = path.join(TEMP_DIR, `${jobId}_list.txt`)
    const concatFile = path.join(TEMP_DIR, `${jobId}_concat.mp4`)
    const outputFile = path.join(OUTPUT_DIR, `${jobId}.mp4`)

    fs.writeFileSync(listFile, trimmedPaths.map(p => `file '${p}'`).join('\n'))
    await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${concatFile}"`, { timeout: 3600000 })

    trimmedPaths.forEach(p => fs.unlink(p, () => {}))
    fs.unlink(listFile, () => {})

    updateJob({ status: 'rendering', progress: 85, progressLabel: 'Adding audio...' })

    const hasAudio = req.audioMode !== 'none' && req.audioFile
    const hasCaptions = req.addCaptions && req.captionStyle

    let audioPath = ''
    if (hasAudio && req.audioFile) {
      audioPath = req.audioMode === 'tts'
        ? path.join(process.cwd(), 'public', 'tts', path.basename(req.audioFile))
        : path.join(process.cwd(), 'public', 'uploads', path.basename(req.audioFile))
    }

    const captionText = usable.map(s => s.text.replace(/^↳\s*/, '')).join(' ')
    const totalDuration = usable.reduce((a, s) => a + s.duration, 0)

    let inputs  = `-i "${concatFile}"`
    let maps    = '-map 0:v'
    let audioArgs = '-an'

    if (hasAudio && audioPath && fs.existsSync(audioPath)) {
      inputs   += ` -i "${audioPath}"`
      maps     += ' -map 1:a'
      audioArgs = '-c:a aac -b:a 128k -shortest'
    }

    let vfArgs = ''
    if (hasCaptions) {
      const captionFilter = buildCaptionFilter(captionText.slice(0, 200), req.captionStyle, totalDuration)
      vfArgs = `-vf "${captionFilter}"`
    }

    // ultrafast for final output too
    await execAsync(
      `ffmpeg -y ${inputs} ${maps} ${vfArgs} -c:v libx264 -preset ultrafast -crf 28 ${audioArgs} "${outputFile}"`,
      { timeout: 3600000 }
    )

    fs.unlink(concatFile, () => {})

    updateJob({
      status: 'done',
      url: `/renders/${jobId}.mp4`,
      duration: totalDuration,
      progress: 100,
      progressLabel: 'Done!',
    })

  } catch (err: any) {
    console.error('Render error:', err)
    updateJob({ status: 'failed', error: err.message ?? 'Render failed.' })
  }
}

export async function submitRender(req: RenderRequest): Promise<RenderResponse> {
  const jobId = `render_${Date.now()}`
  const initial: RenderResponse = { renderId: jobId, status: 'queued', progress: 0, progressLabel: 'Starting...' }
  jobs.set(jobId, initial)
  saveJobs(jobs)
  runRender(jobId, req).catch(console.error)
  return initial
}

export async function getRenderStatus(renderId: string): Promise<RenderResponse> {
  return jobs.get(renderId) ?? { renderId, status: 'failed', error: 'Job not found.' }
}
