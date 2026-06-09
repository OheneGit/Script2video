import type { VideoClip, YouTubeInsight } from './types'

// ─── Page tracker — rotates through pages per keyword ──────────
// So we never get the same page 1 results repeatedly
const keywordPageTracker = new Map<string, number>()

function getNextPage(keyword: string): number {
  const current = keywordPageTracker.get(keyword) ?? 1
  const next = current >= 5 ? 1 : current + 1  // rotate pages 1-5
  keywordPageTracker.set(keyword, next)
  return current
}

export function resetPageTracker() {
  keywordPageTracker.clear()
}

// ─── Pexels ────────────────────────────────────────────────────

export async function searchPexels(
  query: string,
  perPage: number = 10,
): Promise<VideoClip[]> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return []

  try {
    const page = getNextPage(`pexels_${query}`)
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&orientation=landscape`
    const res = await fetch(url, { 
      headers: { Authorization: key },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return []

    const data = await res.json()
    return (data.videos ?? []).map((v: any) => {
      const hdFile =
        v.video_files?.find((f: any) => f.quality === 'hd' && f.file_type === 'video/mp4') ||
        v.video_files?.[0]
      return {
        id: `pexels_${v.id}`,
        source: 'pexels' as const,
        title: v.url?.split('/').at(-2)?.replace(/-/g, ' ') || query,
        thumb: v.image,
        videoUrl: hdFile?.link ?? '',
        duration: v.duration,
        width: hdFile?.width,
        height: hdFile?.height,
        tags: [],
      }
    })
  } catch { return [] }
}

// ─── Pixabay ───────────────────────────────────────────────────

function simplifyForPixabay(query: string): string {
  const stop = new Set([
    'the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could',
    'should','may','might','to','of','in','on','at','by','for',
    'with','about','into','and','or','but','that','this','these',
    'those','close','up','aerial','shot','view','background',
  ])
  const words = query.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/)
    .filter(w => w.length > 2 && !stop.has(w))
  return words.slice(0, 2).join(' ') || query.split(' ')[0]
}

export async function searchPixabay(
  query: string,
  perPage: number = 10,
): Promise<VideoClip[]> {
  const key = process.env.PIXABAY_API_KEY
  if (!key) return []

  const queriesToTry = [
    query,
    simplifyForPixabay(query),
    query.split(' ')[0],
  ].filter((q, i, arr) => q && arr.indexOf(q) === i)

  for (const q of queriesToTry) {
    try {
      const page = getNextPage(`pixabay_${q}`)
      const url =
        `https://pixabay.com/api/videos/?key=${key}` +
        `&q=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}&video_type=film&safesearch=true`
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) continue

      const data = await res.json()
      if (!data.hits || data.hits.length === 0) continue

      return data.hits.map((v: any) => ({
        id: `pixabay_${v.id}`,
        source: 'pixabay' as const,
        title: v.tags || q,
        thumb: v.videos?.medium?.thumbnail ?? v.previewURL,
        videoUrl: v.videos?.medium?.url ?? v.videos?.small?.url ?? '',
        duration: v.duration,
        width: v.videos?.medium?.width,
        height: v.videos?.medium?.height,
        tags: (v.tags ?? '').split(',').map((t: string) => t.trim()),
      }))
    } catch { continue }
  }
  return []
}

// ─── YouTube Creative Commons ──────────────────────────────────

import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execAsync = promisify(exec)
const YT_CACHE_DIR = path.join(process.cwd(), 'tmp_clips', 'yt_cache')

function ensureYTCache() {
  if (!fs.existsSync(YT_CACHE_DIR)) fs.mkdirSync(YT_CACHE_DIR, { recursive: true })
}

async function checkYtDlp(): Promise<boolean> {
  try { await execAsync('yt-dlp --version'); return true } catch { return false }
}

export async function searchYouTubeCC(
  query: string,
  maxResults: number = 3,
): Promise<VideoClip[]> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) return []

  try {
    const url =
      `https://www.googleapis.com/youtube/v3/search?part=snippet` +
      `&q=${encodeURIComponent(query)}&maxResults=${maxResults}&type=video` +
      `&videoLicense=creativeCommon&videoDuration=short&key=${key}`

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return []

    const data = await res.json()
    const items = data.items ?? []
    if (items.length === 0) return []

    const hasYtDlp = await checkYtDlp()
    if (!hasYtDlp) return []

    ensureYTCache()
    const clips: VideoClip[] = []

    for (const item of items.slice(0, maxResults)) {
      const videoId = item.id.videoId
      const title   = item.snippet.title
      const thumb   = item.snippet.thumbnails?.medium?.url ?? ''
      const outPath = path.join(YT_CACHE_DIR, `${videoId}.mp4`)

      try {
        if (!fs.existsSync(outPath)) {
          await execAsync(
            `yt-dlp -f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]" ` +
            `--merge-output-format mp4 -o "${outPath}" ` +
            `"https://www.youtube.com/watch?v=${videoId}"`,
            { timeout: 120000 }
          )
        }
        if (!fs.existsSync(outPath)) continue

        let duration = 10
        try {
          const { stdout } = await execAsync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outPath}"`)
          duration = Math.round(parseFloat(stdout.trim())) || 10
        } catch {}

        const publicPath = path.join(process.cwd(), 'public', 'yt_cache')
        if (!fs.existsSync(publicPath)) fs.mkdirSync(publicPath, { recursive: true })
        const publicFile = path.join(publicPath, `${videoId}.mp4`)
        if (!fs.existsSync(publicFile)) fs.copyFileSync(outPath, publicFile)

        clips.push({
          id: `youtube_${videoId}`,
          source: 'youtube' as const,
          title, thumb,
          videoUrl: `/yt_cache/${videoId}.mp4`,
          duration, tags: [],
        })
      } catch {}
    }
    return clips
  } catch { return [] }
}

// ─── YouTube metadata only ─────────────────────────────────────

export async function searchYouTube(query: string): Promise<YouTubeInsight> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) return { query, results: [] }

  try {
    const url =
      `https://www.googleapis.com/youtube/v3/search?part=snippet` +
      `&q=${encodeURIComponent(query)}&maxResults=3&type=video&videoDuration=short&key=${key}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return { query, results: [] }

    const data = await res.json()
    return {
      query,
      results: (data.items ?? []).map((item: any) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        thumb: item.snippet.thumbnails?.medium?.url ?? '',
        channel: item.snippet.channelTitle,
      })),
    }
  } catch { return { query, results: [] } }
}
