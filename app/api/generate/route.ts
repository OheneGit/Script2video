import { NextRequest, NextResponse } from 'next/server'
import { extractKeywords } from '../../lib/keywords'
import { searchPexels, searchPixabay, searchYouTube, searchYouTubeCC, resetPageTracker } from '../../lib/fetchers'
import type { GenerateRequest, GenerateResponse, ScriptSegment, YouTubeInsight, VideoClip } from '../../lib/types'

const COLORS = [
  '#7F77DD','#1D9E75','#D85A30','#378ADD',
  '#BA7517','#993556','#639922','#888780',
]

const FALLBACK_KEYWORDS = [
  'people','nature','city','water','sky',
  'road','forest','ocean','sunset','building',
  'man walking','woman working','crowd','trees','mountains',
]

function parseSegments(script: string): string[] {
  return script
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim().replace(/^[A-Za-z0-9\s]+:\s*/, ''))
    .filter(s => s.length > 20)
}

function estimateSpeakingTime(text: string): number {
  const words = text.trim().split(/\s+/).length
  return Math.max(3, Math.round(words / 2.17))
}

function proportionalDuration(text: string, allLines: string[], audioDuration: number): number {
  const totalWords = allLines.reduce((sum, l) => sum + l.trim().split(/\s+/).length, 0)
  const sentenceWords = text.trim().split(/\s+/).length
  return Math.max(3, Math.round((sentenceWords / totalWords) * audioDuration))
}

function smartSplit(sentenceDuration: number, clipMaxDuration: number, bestClipDuration: number): { numClips: number; clipDuration: number } {
  if (bestClipDuration >= sentenceDuration) return { numClips: 1, clipDuration: sentenceDuration }
  let numClips: number
  if (sentenceDuration <= 4)       numClips = 1
  else if (sentenceDuration <= 8)  numClips = 2
  else if (sentenceDuration <= 12) numClips = 3
  else                              numClips = 4
  const clipDuration = Math.min(clipMaxDuration, Math.max(3, Math.round(sentenceDuration / numClips)))
  return { numClips, clipDuration }
}

// Track clip usage to avoid repetition
const clipUsageCount = new Map<string, number>()
const MAX_CLIP_REUSE = 1

function deduplicateClips(clips: VideoClip[]): VideoClip[] {
  const sorted = [...clips].sort((a, b) => (clipUsageCount.get(a.id) ?? 0) - (clipUsageCount.get(b.id) ?? 0))
  const pick = sorted.find(c => (clipUsageCount.get(c.id) ?? 0) < MAX_CLIP_REUSE)
  if (pick) {
    clipUsageCount.set(pick.id, (clipUsageCount.get(pick.id) ?? 0) + 1)
    return [pick, ...sorted.filter(c => c.id !== pick.id)]
  }
  if (sorted[0]) clipUsageCount.set(sorted[0].id, (clipUsageCount.get(sorted[0].id) ?? 0) + 1)
  return sorted
}

// Search with retry + fallback
async function searchWithFallback(
  keyword: string,
  perPage: number,
  sources: { pexels: boolean; pixabay: boolean; youtube: boolean },
  segmentIndex: number
): Promise<VideoClip[]> {

  async function doSearch(q: string): Promise<VideoClip[]> {
    try {
      const [pexels, pixabay, ytcc] = await Promise.all([
        sources.pexels  ? searchPexels(q, perPage)   : Promise.resolve([]),
        sources.pixabay ? searchPixabay(q, perPage)  : Promise.resolve([]),
        sources.youtube ? searchYouTubeCC(q, 2)      : Promise.resolve([]),
      ])
      const interleaved: VideoClip[] = []
      const maxLen = Math.max(pexels.length, pixabay.length, ytcc.length)
      for (let idx = 0; idx < maxLen; idx++) {
        if (pexels[idx])  interleaved.push(pexels[idx])
        if (pixabay[idx]) interleaved.push(pixabay[idx])
        if (ytcc[idx])    interleaved.push(ytcc[idx])
      }
      return deduplicateClips(interleaved)
    } catch { return [] }
  }

  // Attempt 1: original
  let clips = await doSearch(keyword)
  if (clips.length > 0) return clips

  // Attempt 2: simplified (first 2 words)
  const simplified = keyword.split(' ').slice(0, 2).join(' ')
  if (simplified !== keyword) {
    clips = await doSearch(simplified)
    if (clips.length > 0) return clips
  }

  // Attempt 3: first word only
  const firstWord = keyword.split(' ')[0]
  clips = await doSearch(firstWord)
  if (clips.length > 0) return clips

  // Attempt 4: generic fallback
  const fallback = FALLBACK_KEYWORDS[segmentIndex % FALLBACK_KEYWORDS.length]
  clips = await doSearch(fallback)
  if (clips.length > 0) return clips

  // Attempt 5: guaranteed terms
  for (const term of ['people', 'nature', 'city', 'water', 'sky']) {
    clips = await doSearch(term)
    if (clips.length > 0) return clips
  }
  return []
}

// Process segments in batches to avoid timeout
async function processBatch(
  batch: { text: string; index: number }[],
  lines: string[],
  sources: { pexels: boolean; pixabay: boolean; youtube: boolean },
  clipDuration: number,
  hasAudio: boolean,
  audioDuration: number | undefined,
  resultsPerSegment: number,
  ytInsights: YouTubeInsight[],
  segments: ScriptSegment[]
) {
  await Promise.all(
    batch.map(async ({ text, index: i }) => {
      try {
        const kwSet = await extractKeywords(text)

        const sentenceDuration = hasAudio
          ? proportionalDuration(text, lines, audioDuration!)
          : estimateSpeakingTime(text)

        const firstClips = await searchWithFallback(kwSet.picks[0], 5, sources, i)
        const bestClipDuration = firstClips.length > 0 ? (firstClips[0].duration || 0) : 0

        const { numClips, clipDuration: subDur } = smartSplit(sentenceDuration, clipDuration, bestClipDuration)
        const picksToSearch = kwSet.picks.slice(0, numClips)

        const allClipGroups = await Promise.all(
          picksToSearch.map(async (keyword, ki) => {
            const clips = await searchWithFallback(keyword, resultsPerSegment, sources, i + ki)
            console.log(`[${keyword}] found: ${clips.length} clips`)
            return { keyword, clips }
          })
        )

        if (sources.youtube) {
          try {
            const yt = await searchYouTube(kwSet.picks[0])
            if (yt.results.length > 0) ytInsights.push(yt)
          } catch {}
        }

        const subSegs: ScriptSegment[] = allClipGroups
          .filter(g => g.clips.length > 0)
          .map((g, si) => ({
            index: i * 10 + si,
            text: si === 0 ? text : `↳ ${g.keyword}`,
            keywords: g.keyword,
            clips: g.clips,
            chosenIndex: 0,
            duration: subDur,
            color: COLORS[i % COLORS.length],
            parentIndex: i,
            keywordOptions: kwSet.options,
            speakingTime: sentenceDuration,
          }))

        if (subSegs.length === 0) {
          const fallbackClips = await searchWithFallback('people city', resultsPerSegment, sources, i)
          segments[i * 10] = {
            index: i * 10, text, keywords: 'people city',
            clips: fallbackClips, chosenIndex: 0, duration: sentenceDuration,
            color: COLORS[i % COLORS.length], keywordOptions: kwSet.options,
          }
        } else {
          subSegs.forEach((s, si) => { segments[i * 10 + si] = s })
        }
      } catch (err) {
        console.error(`Segment ${i} error:`, err)
        // Add empty segment so we don't lose it
        segments[i * 10] = {
          index: i * 10, text, keywords: 'people',
          clips: [], chosenIndex: 0, duration: estimateSpeakingTime(text),
          color: COLORS[i % COLORS.length],
        }
      }
    })
  )
}

export async function POST(req: NextRequest) {
  try {
    const body: GenerateRequest = await req.json()
    const { script, sources, clipDuration, resultsPerSegment, audioDuration } = body

    if (!script || script.trim().length < 20) {
      return NextResponse.json({ error: 'Script too short.' }, { status: 400 })
    }

    const lines = parseSegments(script)
    if (lines.length === 0) {
      return NextResponse.json({ error: 'No segments found.' }, { status: 400 })
    }

    clipUsageCount.clear()
    resetPageTracker()  // reset page rotation for fresh results
    const hasAudio = !!audioDuration && audioDuration > 0
    const segments: ScriptSegment[] = []
    const ytInsights: YouTubeInsight[] = []

    // Process in batches of 8 to avoid connection timeouts
    const BATCH_SIZE = 8
    const indexed = lines.map((text, index) => ({ text, index }))

    for (let i = 0; i < indexed.length; i += BATCH_SIZE) {
      const batch = indexed.slice(i, i + BATCH_SIZE)
      await processBatch(batch, lines, sources, clipDuration, hasAudio, audioDuration, resultsPerSegment, ytInsights, segments)
    }

    const sorted = Object.values(segments)
      .filter(Boolean)
      .sort((a, b) => a.index - b.index)

    // Scale durations to match exact audio length
    if (hasAudio && audioDuration && audioDuration > 0) {
      const target = Math.round(audioDuration)
      // Distribute target seconds proportionally by word count, no artificial minimum
      const totalWords = sorted.reduce((a, s) => a + s.text.trim().split(/\s+/).length, 0)
      let allocated = 0
      sorted.forEach((s, i) => {
        if (i === sorted.length - 1) {
          s.duration = Math.max(1, target - allocated)
        } else {
          const words = s.text.trim().split(/\s+/).length
          const d = Math.max(1, Math.round((words / totalWords) * target))
          s.duration = d
          allocated += d
        }
      })
    }

    const totalDuration = sorted.reduce((acc, s) => acc + s.duration, 0)
    return NextResponse.json({ segments: sorted, ytInsights, totalDuration } as GenerateResponse)

  } catch (err: any) {
    console.error('/api/generate error', err)
    return NextResponse.json({ error: err.message ?? 'Unknown error' }, { status: 500 })
  }
}
