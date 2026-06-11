'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { ScriptSegment, RenderRequest, RenderResponse, CaptionStyle } from '../lib/types'

interface EditorProps {
  segments: ScriptSegment[]
  totalDuration: number
  audioMode: 'none' | 'tts' | 'upload'
  audioFile?: string
  audioDuration?: number
  audioUrl?: string
  onBack: () => void
}

type SidebarTab = 'story' | 'visuals' | 'audio' | 'text' | 'elements' | 'styles'

const CAPTION_FONTS = ['Arial','Impact','Montserrat','Bebas Neue','Oswald','Roboto','Lato','Playfair Display']
const DEFAULT_CAPTION: CaptionStyle = {
  font: 'Arial', fontSize: 48, color: '#ffffff',
  bgColor: '#000000', position: 'bottom', style: 'shadow',
}
const BASE_PX_PER_SEC = 10

function fmtDur(s: number) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60), sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}
function fmtSec(s: number) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}
function fmtRulerLabel(secs: number) {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60), s = secs % 60
  return s === 0 ? `${m}m` : `${m}m${s}s`
}
function getRulerStep(pxPerSec: number): number {
  const target = 70
  const secsPerTarget = target / pxPerSec
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
  return steps.find(s => s >= secsPerTarget) ?? 3600
}

// ── Coin sound (real MP3 at 20% vol) ─────────────────────────
function playCoinSound() {
  try {
    const audio = new Audio('/coin.mp3')
    audio.volume = 0.2
    audio.play().catch(() => {})
  } catch {}
}

// ─── Stat extraction ───────────────────────────────────────────
type StatType = 'percent' | 'year' | 'date' | 'money' | 'figure'
interface StatItem { id: number; raw: string; type: StatType; numericTarget?: number; dateSequence?: string[] }
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function buildDateSequence(raw: string): string[] {
  const monthMatch = raw.match(new RegExp(`(${MONTHS.join('|')})`, 'i'))
  if (!monthMatch) return [raw]
  const monthName = monthMatch[1]
  const monthIdx  = MONTHS.findIndex(m => m.toLowerCase() === monthName.toLowerCase())
  const dayMatch  = raw.match(/(\d{1,2})(?:st|nd|rd|th)?/)
  const yearMatch = raw.match(/\b(19|20)\d{2}\b/)
  if (dayMatch) {
    const day = parseInt(dayMatch[1])
    return Array.from({ length: Math.min(day, 9) }, (_, k) => `${Math.max(1, day - 8 + k)} ${monthName}`)
  }
  if (yearMatch) {
    const year = parseInt(yearMatch[0])
    return Array.from({ length: Math.min(monthIdx + 1, 5) }, (_, k) => `${MONTHS[Math.max(0, monthIdx - 4 + k)]} ${year}`)
  }
  return [raw]
}
function parseNumeric(raw: string): number | undefined {
  const s = raw.replace(/[$£€₦₵¥,\s]/g, '')
  const m = s.match(/^([\d.]+)([a-z]*)$/i)
  if (!m) return undefined
  const mults: Record<string,number> = { k:1e3,m:1e6,b:1e9,t:1e12,thousand:1e3,million:1e6,billion:1e9,trillion:1e12 }
  return parseFloat(m[1]) * (mults[m[2].toLowerCase()] ?? 1)
}
function extractStats(text: string): StatItem[] {
  const items: StatItem[] = []; const seen = new Set<string>(); let id = 0
  const push = (raw: string, type: StatType, extra?: Partial<StatItem>) => {
    const key = raw.toLowerCase().trim()
    if (seen.has(key)) return; seen.add(key)
    items.push({ id: id++, raw: raw.trim(), type, ...extra })
  }
  Array.from(text.matchAll(/[$£€₦₵¥]\s*[\d,]+(?:\.\d+)?(?:\s*[BMKbmk](?:illion)?)?/g)).forEach(m => push(m[0].trim(), 'money', { numericTarget: parseNumeric(m[0]) }))
  Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)).forEach(m => push(m[0].trim(), 'percent', { numericTarget: parseFloat(m[1]) }))
  const capturedYears = new Set<string>()
  Array.from(text.matchAll(new RegExp(`\\b(${MONTHS.join('|')})\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s*)?\\d{0,4}\\b`, 'gi'))).forEach(m => {
    const v = m[0].trim().replace(/,\s*$/, ''); if (v.length < 4) return
    const yr = v.match(/\b(19|20)\d{2}\b/); if (yr) capturedYears.add(yr[0])
    push(v, 'date', { dateSequence: buildDateSequence(v) })
  })
  Array.from(text.matchAll(/\b(19|20)\d{2}\b/g)).forEach(m => {
    if (capturedYears.has(m[0])) return
    push(m[0], 'year', { numericTarget: parseInt(m[0]) })
  })
  Array.from(text.matchAll(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s+(?:million|billion|trillion|thousand)\b/gi)).forEach(m => push(m[0].trim(), 'figure', { numericTarget: parseNumeric(m[0]) }))
  return items.slice(0, 4)
}

// ─── Animated stat components ──────────────────────────────────
const GLOW: Record<StatType,string> = { percent:'#a78bfa', year:'#38bdf8', date:'#34d399', money:'#fbbf24', figure:'#f87171' }

function useCountUp(target: number, ms = 1100) {
  const [v, setV] = useState(0)
  useEffect(() => {
    setV(0); const t0 = performance.now(); let raf: number
    const tick = (now: number) => {
      const p = Math.min((now - t0) / ms, 1)
      setV(Math.round((1 - Math.pow(1 - p, 3)) * target))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}
function fmtBig(n: number) {
  return n >= 1e9 ? `${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : n.toLocaleString()
}
function Glow({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ color, textShadow: `0 0 16px ${color}99, 0 0 32px ${color}44`, fontVariantNumeric: 'tabular-nums' }}>{children}</span>
}
function AnimDate({ seq, color }: { seq: string[]; color: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    setI(0); let cur = 0
    const iv = setInterval(() => { cur++; setI(cur); if (cur >= seq.length - 1) clearInterval(iv) }, 120)
    return () => clearInterval(iv)
  }, [seq.join('|')])
  return <Glow color={color}>{seq[i] ?? seq[seq.length - 1]}</Glow>
}
function StatBadge({ item, index }: { item: StatItem; index: number }) {
  const color = GLOW[item.type]
  const labels: Record<StatType,string> = { percent:'Rate', year:'Year', date:'Date', money:'Amount', figure:'Figure' }
  const pct  = useCountUp(item.type === 'percent' ? (item.numericTarget ?? 0) : 0)
  const yr   = useCountUp(item.type === 'year'    ? (item.numericTarget ?? 0) - Math.max(0, (item.numericTarget ?? 0) - 10) : 0, 900)
  const mon  = useCountUp(item.type === 'money'   ? (item.numericTarget ?? 0) : 0, 1000)
  const fig  = useCountUp(item.type === 'figure'  ? (item.numericTarget ?? 0) : 0, 1000)
  const yrBase = Math.max(0, (item.numericTarget ?? 0) - 10)
  return (
    <div className="stat-badge flex flex-col items-end pointer-events-none" style={{ animationDelay: `${index * 380}ms` }}>
      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: color + 'aa', marginBottom: 2 }}>{labels[item.type]}</span>
      <span style={{ fontSize: 30, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.02em' }}>
        {item.type === 'percent' && <Glow color={color}>{pct}<span style={{ fontSize: '0.55em', opacity: 0.75 }}>%</span></Glow>}
        {item.type === 'year'    && <Glow color={color}>{yrBase + yr}</Glow>}
        {item.type === 'money'   && <Glow color={color}>{(item.raw.match(/^[$£€₦₵¥]/)?.[0] ?? '')}{fmtBig(mon)}</Glow>}
        {item.type === 'figure'  && <Glow color={color}>{fmtBig(fig)}</Glow>}
        {item.type === 'date'    && item.dateSequence && <AnimDate seq={item.dateSequence} color={color}/>}
        {((item.type === 'money' && item.numericTarget == null) || (item.type === 'figure' && item.numericTarget == null)) && <Glow color={color}>{item.raw}</Glow>}
      </span>
    </div>
  )
}

// ─── Sidebar icons ─────────────────────────────────────────────
function boldKeywords(text: string, keywords: string) {
  if (!keywords) return <span>{text}</span>
  const words = keywords.split(/[\s,]+/).filter(w => w.length > 3)
  if (!words.length) return <span>{text}</span>
  const pat = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return <span>{text.split(pat).map((p, i) => pat.test(p) ? <strong key={i} className="font-semibold text-gray-900">{p}</strong> : <span key={i}>{p}</span>)}</span>
}
const SI = {
  story:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>,
  visuals:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>,
  audio:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  text:     () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>,
  elements: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>,
  styles:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 010 20"/><path d="M2 12h20"/></svg>,
}

// ─── Main Editor ───────────────────────────────────────────────
export default function VideoEditor({ segments: init, totalDuration, audioMode, audioFile, audioDuration, audioUrl, onBack }: EditorProps) {
  const [segments, setSegments]         = useState<ScriptSegment[]>(init)
  const [activeIdx, setActiveIdx]       = useState(0)
  const [sideTab, setSideTab]           = useState<SidebarTab>('story')
  const [addCaptions, setAddCaptions]   = useState(false)
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION)
  const [transition, setTransition]     = useState<'cut'|'fade'|'zoom'>('cut')
  const [resolution, setResolution]     = useState<RenderRequest['resolution']>('1920x1080')
  const [rendering, setRendering]       = useState(false)
  const [renderStatus, setRenderStatus] = useState<RenderResponse | null>(null)
  const [regenLoading, setRegenLoading] = useState<number | null>(null)
  const [reorderDrag, setReorderDrag]   = useState<number | null>(null)
  const [reorderOver, setReorderOver]   = useState<number | null>(null)
  const [search, setSearch]             = useState('')
  const [zoom, setZoom]                 = useState(1)
  const [stats, setStats]               = useState<StatItem[]>([])
  const [statVer, setStatVer]           = useState(0)  // bump to force badge re-mount

  // ── Undo / Redo history ──
  const historyStack = useRef<ScriptSegment[][]>([init])
  const historyPos   = useRef(0)
  const setSegmentsH = useCallback((updater: ScriptSegment[] | ((p: ScriptSegment[]) => ScriptSegment[])) => {
    setSegments(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      historyStack.current = historyStack.current.slice(0, historyPos.current + 1)
      historyStack.current.push(next)
      historyPos.current = historyStack.current.length - 1
      return next
    })
  }, [])
  const undo = useCallback(() => {
    if (historyPos.current <= 0) return
    historyPos.current--
    setSegments(historyStack.current[historyPos.current])
  }, [])
  const redo = useCallback(() => {
    if (historyPos.current >= historyStack.current.length - 1) return
    historyPos.current++
    setSegments(historyStack.current[historyPos.current])
  }, [])

  // Playback state
  const videoRef        = useRef<HTMLVideoElement>(null)
  const audioRef        = useRef<HTMLAudioElement>(null)
  const timelineRef     = useRef<HTMLDivElement>(null)
  const [playing, setPlaying]           = useState(false)
  const [globalPlaying, setGlobalPlaying] = useState(false)
  const [videoTime, setVideoTime]       = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)

  // Refs that mirror state/props for use inside event handlers (avoid stale closures)
  const segmentsRef     = useRef(segments)
  const activeIdxRef    = useRef(activeIdx)
  const playingRef      = useRef(false)
  const globalPlayRef   = useRef(false)
  const audioUrlRef     = useRef(audioUrl)
  const pxPerSecRef     = useRef(BASE_PX_PER_SEC)

  useEffect(() => { segmentsRef.current  = segments  }, [segments])
  useEffect(() => { activeIdxRef.current = activeIdx }, [activeIdx])
  useEffect(() => { playingRef.current   = playing   }, [playing])
  useEffect(() => { audioUrlRef.current  = audioUrl  }, [audioUrl])

  // Resize + scrub refs
  const resizingIdx    = useRef<number | null>(null)
  const resizeStartX   = useRef(0)
  const resizeStartDur = useRef(0)
  const scrubbingRef   = useRef(false)

  const activeSeg = segments[activeIdx]
  const chosen    = activeSeg?.clips[activeSeg.chosenIndex]
  const totalDur  = segments.reduce((a, s) => a + s.duration, 0)
  const pxPerSec  = BASE_PX_PER_SEC * zoom
  const rulerStep = getRulerStep(pxPerSec)

  useEffect(() => { pxPerSecRef.current = pxPerSec }, [pxPerSec])

  const sceneStarts = segments.reduce<number[]>((acc, s, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + segments[i - 1].duration); return acc
  }, [])
  const activeStart  = sceneStarts[activeIdx] ?? 0
  const playheadSec  = activeStart + videoTime
  const playheadPct  = totalDur > 0 ? (playheadSec / totalDur) * 100 : 0

  // ── Scene change effect ──
  useEffect(() => {
    setVideoTime(0); setVideoDuration(0)
    if (!globalPlayRef.current) {
      setPlaying(false); playingRef.current = false
      const a = audioRef.current
      if (a && audioUrl) { a.pause(); a.currentTime = activeStart }
    }
  }, [activeIdx])

  // ── Stat highlights with coin sound ──
  useEffect(() => {
    setStats([]); setStatVer(v => v + 1)
    if (!activeSeg?.text) return
    const found = extractStats(activeSeg.text)
    const timers: ReturnType<typeof setTimeout>[] = []
    found.forEach((s, i) => {
      timers.push(setTimeout(() => {
        setStats(prev => [...prev, s])
        playCoinSound()
      }, i * 380))
    })
    return () => timers.forEach(clearTimeout)  // cancel if scene changes mid-animation
  }, [activeIdx])

  // ── Global play/pause ──
  const toggleGlobalPlay = () => {
    const v = videoRef.current; const a = audioRef.current
    if (globalPlayRef.current) {
      globalPlayRef.current = false; setGlobalPlaying(false)
      setPlaying(false); playingRef.current = false
      v?.pause(); a?.pause()
    } else {
      globalPlayRef.current = true; setGlobalPlaying(true)
      setPlaying(true); playingRef.current = true
      if (v && chosen?.videoUrl && chosen.source !== 'youtube') { v.currentTime = 0; v.play().catch(() => {}) }
      if (a && audioUrl) { a.currentTime = activeStart; a.play().catch(() => {}) }
    }
  }

  // ── Per-scene play/pause ──
  const togglePlay = () => {
    const v = videoRef.current; const a = audioRef.current
    if (globalPlayRef.current) { toggleGlobalPlay(); return }
    if (playingRef.current) {
      v?.pause(); a?.pause(); setPlaying(false); playingRef.current = false
    } else {
      if (a && audioUrl) { a.currentTime = activeStart + videoTime; a.play().catch(() => {}) }
      if (v && chosen?.videoUrl && chosen.source !== 'youtube') v.play().catch(() => {})
      setPlaying(true); playingRef.current = true
    }
  }

  // ── Advance to next scene imperatively (bypasses React render delay) ──
  const advancingScene = useRef(false)
  const advanceToScene = useCallback((v: HTMLVideoElement, nextIdx: number) => {
    if (advancingScene.current) return
    advancingScene.current = true
    activeIdxRef.current = nextIdx
    setActiveIdx(nextIdx)   // updates UI / timeline / stat badges
    setVideoTime(0)

    const nextSeg  = segmentsRef.current[nextIdx]
    const nextClip = nextSeg?.clips[nextSeg.chosenIndex]

    if (nextClip?.videoUrl && nextClip.source !== 'youtube') {
      // Change src directly — don't wait for React reconciliation
      v.src = nextClip.videoUrl
      v.load()
      const onReady = () => { v.play().catch(() => {}); v.removeEventListener('canplay', onReady) }
      v.addEventListener('canplay', onReady)
    }
    setTimeout(() => { advancingScene.current = false }, 400)
  }, [])

  // ── Video time update — enforce scene duration ──
  const onTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    const t = v.currentTime
    setVideoTime(t)
    const sceneDur = segmentsRef.current[activeIdxRef.current]?.duration ?? Infinity
    if (t >= sceneDur) {
      if (globalPlayRef.current) {
        const nextIdx = activeIdxRef.current + 1
        if (nextIdx < segmentsRef.current.length) {
          advanceToScene(v, nextIdx)
        } else {
          globalPlayRef.current = false; setGlobalPlaying(false)
          setPlaying(false); playingRef.current = false
          v.pause(); audioRef.current?.pause()
        }
      } else {
        v.currentTime = 0; setVideoTime(0)
      }
    }
  }

  // ── Video ended (clip shorter than scene duration) ──
  const onVideoEnded = () => {
    if (globalPlayRef.current) {
      const v = videoRef.current
      const nextIdx = activeIdxRef.current + 1
      if (v && nextIdx < segmentsRef.current.length) {
        advanceToScene(v, nextIdx)
      } else {
        globalPlayRef.current = false; setGlobalPlaying(false)
        setPlaying(false); playingRef.current = false
        audioRef.current?.pause()
      }
    } else {
      setPlaying(false); playingRef.current = false; audioRef.current?.pause()
    }
  }

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value)
    const v = videoRef.current; const a = audioRef.current
    if (v) v.currentTime = t
    if (a && audioUrl) a.currentTime = activeStart + t
    setVideoTime(t)
  }

  // ── Timeline mouse wheel → horizontal scroll ──
  const onTimelineWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX
  }

  // ── Timeline scrub start ──
  const onTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).classList.contains('resize-handle')) return
    scrubbingRef.current = true
    seekToMouse(e.clientX)
  }

  const seekToMouse = (clientX: number) => {
    const container = timelineRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const x = clientX - rect.left + container.scrollLeft - 12
    const segs = segmentsRef.current
    const totDur = segs.reduce((a, s) => a + s.duration, 0)
    const time = Math.max(0, Math.min(totDur, x / pxPerSecRef.current))
    let cum = 0, idx = segs.length - 1, offset = segs[idx]?.duration ?? 0
    for (let i = 0; i < segs.length; i++) {
      if (time < cum + segs[i].duration) { idx = i; offset = time - cum; break }
      cum += segs[i].duration
    }
    setActiveIdx(idx)
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, offset)
    if (audioRef.current && audioUrlRef.current) audioRef.current.currentTime = time
    setVideoTime(Math.max(0, offset))
  }

  // ── Resize + Scrub + Spacebar — single window listener ──
  useEffect(() => {
    const mv = (e: MouseEvent) => {
      if (resizingIdx.current !== null) {
        const segs = segmentsRef.current
        const seg  = segs[resizingIdx.current]
        const clipMax = seg?.clips[seg.chosenIndex]?.duration ?? 999
        const newDur = Math.max(2, Math.min(clipMax, Math.round(resizeStartDur.current + (e.clientX - resizeStartX.current) / pxPerSecRef.current)))
        setSegmentsH(prev => prev.map((s, i) => i === resizingIdx.current ? { ...s, duration: newDur } : s))
      }
      if (scrubbingRef.current) seekToMouse(e.clientX)
    }
    const up = () => { resizingIdx.current = null; scrubbingRef.current = false }
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); return }
      if (e.code !== 'Space') return
      e.preventDefault()
      const v = videoRef.current; const a = audioRef.current
      if (playingRef.current || globalPlayRef.current) {
        v?.pause(); a?.pause()
        setPlaying(false); playingRef.current = false
        if (globalPlayRef.current) { globalPlayRef.current = false; setGlobalPlaying(false) }
      } else {
        const idx = activeIdxRef.current
        const segs = segmentsRef.current
        const start = segs.slice(0, idx).reduce((acc, s) => acc + s.duration, 0)
        if (a && audioUrlRef.current) { a.currentTime = start + (v?.currentTime ?? 0); a.play().catch(() => {}) }
        v?.play().catch(() => {})
        setPlaying(true); playingRef.current = true
      }
    }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup', up)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousemove', mv)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('keydown', onKey)
    }
  }, []) // empty — all state accessed via refs

  const onResizeDown = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation(); e.preventDefault()
    resizingIdx.current = idx; resizeStartX.current = e.clientX
    resizeStartDur.current = segmentsRef.current[idx].duration
  }

  // Reorder
  const handleDragStart = (i: number) => setReorderDrag(i)
  const handleDragOver  = (e: React.DragEvent, i: number) => { e.preventDefault(); setReorderOver(i) }
  const handleDrop      = (i: number) => {
    if (reorderDrag === null || reorderDrag === i) { setReorderDrag(null); setReorderOver(null); return }
    const s = [...segments]; const [m] = s.splice(reorderDrag, 1); s.splice(i, 0, m)
    setSegmentsH(s); setActiveIdx(i); setReorderDrag(null); setReorderOver(null)
  }

  const regenerateSegment = async (si: number) => {
    setRegenLoading(si)
    try {
      const res = await fetch('/api/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ script:segments[si].text, sources:{pexels:true,pixabay:true,youtube:false}, clipDuration:segments[si].duration, resultsPerSegment:8 }) })
      const data = await res.json()
      if (data.segments?.[0]?.clips?.length > 0) setSegmentsH(prev => prev.map((s,i)=>i===si?{...s,clips:data.segments[0].clips,chosenIndex:0}:s))
    } catch {}
    setRegenLoading(null)
  }
  const swapClip       = (si:number,ci:number) => setSegmentsH(prev=>prev.map((s,i)=>i===si?{...s,chosenIndex:ci}:s))
  const adjustDuration = (si:number,d:number)  => setSegmentsH(prev=>prev.map((s,i)=>i===si?{...s,duration:Math.max(2,s.duration+d)}:s))

  const renderVideo = useCallback(async () => {
    if (rendering) return
    setRendering(true); setRenderStatus({ renderId:'', status:'queued', progress:0 })
    const req: RenderRequest = { segments, resolution, aspectRatio:'16:9', transition, addCaptions, captionStyle, fps:25, audioMode, audioFile }
    try {
      const res  = await fetch('/api/render',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(req) })
      const data: RenderResponse & {error?:string} = await res.json()
      if (!res.ok || data.error) throw new Error(data.error?? 'Render error')
      setRenderStatus(data)
      const poll = setInterval(async()=>{
        const sr = await fetch(`/api/status?id=${data.renderId}`)
        const sd: RenderResponse = await sr.json()
        setRenderStatus(sd)
        if (sd.status==='done'||sd.status==='failed'){ clearInterval(poll); setRendering(false) }
      },3000)
    } catch(err:any){ alert('Render error: '+err.message); setRendering(false) }
  },[segments,resolution,transition,addCaptions,captionStyle,rendering,audioMode,audioFile])

  const filteredSegs = search ? segments.filter((s,i)=>s.text.toLowerCase().includes(search.toLowerCase())||String(i+1).includes(search)) : segments

  // ── Side panel ──
  const renderSidePanel = () => {
    if (sideTab==='story') return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2.5 border-b border-gray-100">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search" className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 outline-none focus:border-purple-400 placeholder-gray-400"/>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {filteredSegs.map(seg=>{
            const ri=segments.indexOf(seg),c=seg.clips[seg.chosenIndex],isActive=ri===activeIdx
            return (
              <div key={ri} draggable onDragStart={()=>handleDragStart(ri)} onDragOver={e=>handleDragOver(e,ri)} onDrop={()=>handleDrop(ri)} onDragEnd={()=>{setReorderDrag(null);setReorderOver(null)}} onClick={()=>setActiveIdx(ri)}
                className={`mx-2 my-1 rounded-xl border-2 cursor-pointer transition-all ${isActive?'border-purple-500 bg-white shadow-sm':reorderOver===ri?'border-yellow-400 bg-yellow-50':'border-transparent bg-white hover:border-gray-200'}`}>
                <div className="p-3">
                  <div className="flex items-start justify-between mb-1.5">
                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Scene {ri+1}</span>
                    <button onClick={e=>{e.stopPropagation();setSegmentsH(prev=>prev.filter((_,i)=>i!==ri));if(activeIdx>=ri&&activeIdx>0)setActiveIdx(activeIdx-1)}} className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                    </button>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{boldKeywords(seg.text.replace(/^↳\s*/,'').slice(0,110),seg.keywords)}</p>
                  {c&&<div className="mt-2 flex items-center gap-1.5"><img src={c.thumb} alt="" className="w-8 h-5 rounded object-cover" onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/><span className="text-[9px] text-gray-400">{seg.duration}s</span><span className={`text-[9px] px-1 rounded ${c.source==='pexels'?'bg-blue-50 text-blue-500':c.source==='pixabay'?'bg-green-50 text-green-600':'bg-red-50 text-red-500'}`}>{c.source}</span></div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
    if (sideTab==='visuals') return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2.5 border-b border-gray-100"><p className="text-xs font-semibold text-gray-700">Clip alternatives</p><p className="text-[10px] text-gray-400 mt-0.5">Click to swap — Scene {activeIdx+1}</p></div>
        <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2 content-start">
          {activeSeg?.clips.map((c,ci)=>(
            <div key={ci} onClick={()=>swapClip(activeIdx,ci)} className={`rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${ci===activeSeg.chosenIndex?'border-purple-500':'border-transparent hover:border-gray-300'}`}>
              <div className="relative"><img src={c.thumb} alt="" className="w-full h-16 object-cover" onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/>{ci===activeSeg.chosenIndex&&<div className="absolute top-1 right-1 w-4 h-4 bg-purple-500 rounded-full flex items-center justify-center"><svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg></div>}</div>
              <div className="px-1.5 py-1 bg-gray-50"><span className={`text-[9px] ${c.source==='pexels'?'text-blue-500':c.source==='pixabay'?'text-green-600':'text-red-500'}`}>{c.source}·{c.duration}s</span></div>
            </div>
          ))}
          {activeSeg&&<button onClick={()=>regenerateSegment(activeIdx)} disabled={regenLoading===activeIdx} className="col-span-2 mt-1 py-2 text-xs text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-40 flex items-center justify-center gap-1.5"><svg className={`w-3.5 h-3.5 ${regenLoading===activeIdx?'animate-spin':''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>{regenLoading===activeIdx?'Searching...':'Find new clips'}</button>}
        </div>
      </div>
    )
    if (sideTab==='audio') return (
      <div className="p-3 space-y-3">
        <p className="text-xs font-semibold text-gray-700">Audio</p>
        {audioUrl?<div className="border border-green-200 bg-green-50 rounded-xl p-3"><p className="text-xs text-green-700 font-medium mb-2">Voiceover · {fmtDur(audioDuration??0)}</p><audio controls src={audioUrl} className="w-full h-8"/></div>:<p className="text-xs text-gray-400">No audio attached.</p>}
      </div>
    )
    if (sideTab==='text') return (
      <div className="p-3 space-y-3">
        <p className="text-xs font-semibold text-gray-700">Captions</p>
        <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Show captions</span><button onClick={()=>setAddCaptions(v=>!v)} className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${addCaptions?'bg-purple-500':'bg-gray-200'}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${addCaptions?'left-5':'left-0.5'}`}/></button></div>
        {addCaptions&&<div className="space-y-3">
          <div><label className="text-[10px] text-gray-500 block mb-1">Font</label><select value={captionStyle.font} onChange={e=>setCaptionStyle(s=>({...s,font:e.target.value}))} className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none bg-gray-50">{CAPTION_FONTS.map(f=><option key={f} value={f}>{f}</option>)}</select></div>
          <div><label className="text-[10px] text-gray-500 block mb-1">Style</label><div className="flex flex-wrap gap-1">{(['normal','bold','shadow','outline','box'] as const).map(st=><button key={st} onClick={()=>setCaptionStyle(s=>({...s,style:st}))} className={`text-[10px] px-2 py-0.5 rounded-md border capitalize ${captionStyle.style===st?'bg-purple-500 text-white border-purple-500':'border-gray-200 text-gray-500'}`}>{st}</button>)}</div></div>
          <div><div className="flex justify-between mb-1"><label className="text-[10px] text-gray-500">Size</label><span className="text-[10px] text-gray-700">{captionStyle.fontSize}px</span></div><input type="range" min="24" max="96" step="4" value={captionStyle.fontSize} onChange={e=>setCaptionStyle(s=>({...s,fontSize:+e.target.value}))} className="w-full accent-purple-500"/></div>
          <div><label className="text-[10px] text-gray-500 block mb-1">Position</label><div className="flex gap-1">{(['top','center','bottom'] as const).map(p=><button key={p} onClick={()=>setCaptionStyle(s=>({...s,position:p}))} className={`flex-1 text-[10px] py-1 rounded-md border capitalize ${captionStyle.position===p?'bg-purple-500 text-white border-purple-500':'border-gray-200 text-gray-500'}`}>{p}</button>)}</div></div>
          <div className="flex gap-2"><div className="flex-1"><label className="text-[10px] text-gray-500 block mb-1">Text</label><input type="color" value={captionStyle.color} onChange={e=>setCaptionStyle(s=>({...s,color:e.target.value}))} className="w-full h-8 rounded-lg cursor-pointer border border-gray-200"/></div><div className="flex-1"><label className="text-[10px] text-gray-500 block mb-1">Background</label><input type="color" value={captionStyle.bgColor} onChange={e=>setCaptionStyle(s=>({...s,bgColor:e.target.value}))} className="w-full h-8 rounded-lg cursor-pointer border border-gray-200"/></div></div>
        </div>}
      </div>
    )
    if (sideTab==='elements') return (
      <div className="p-3 space-y-3">
        <p className="text-xs font-semibold text-gray-700">Output settings</p>
        <div><label className="text-[10px] text-gray-500 block mb-1">Resolution</label><select value={resolution} onChange={e=>setResolution(e.target.value as any)} className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none bg-gray-50"><option value="1920x1080">1080p Full HD</option><option value="1280x720">720p HD</option><option value="3840x2160">4K</option></select></div>
        <div><label className="text-[10px] text-gray-500 block mb-1">Transition</label><div className="flex gap-1">{(['cut','fade','zoom'] as const).map(t=><button key={t} onClick={()=>setTransition(t)} className={`flex-1 text-[10px] py-1.5 rounded-md border capitalize ${transition===t?'bg-purple-500 text-white border-purple-500':'border-gray-200 text-gray-500'}`}>{t}</button>)}</div></div>
        <div><label className="text-[10px] text-gray-500 block mb-1">Scene {activeIdx+1} duration</label>{activeSeg&&<div className="flex items-center gap-2"><button onClick={()=>adjustDuration(activeIdx,-1)} className="w-7 h-7 rounded-lg border border-gray-200 text-gray-600 flex items-center justify-center">−</button><span className="flex-1 text-center text-sm font-medium text-gray-800">{activeSeg.duration}s</span><button onClick={()=>adjustDuration(activeIdx,+1)} className="w-7 h-7 rounded-lg border border-gray-200 text-gray-600 flex items-center justify-center">+</button></div>}</div>
      </div>
    )
    return null
  }

  const sidebarTabs: {key:SidebarTab;label:string}[] = [{key:'story',label:'Story'},{key:'visuals',label:'Visuals'},{key:'audio',label:'Audio'},{key:'text',label:'Text'},{key:'elements',label:'Layouts'},{key:'styles',label:'Styles'}]

  const rulerTicks: number[] = []
  for (let t = 0; t <= totalDur; t += rulerStep) rulerTicks.push(t)

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden" style={{ fontFamily:'Inter, system-ui, sans-serif' }}>
      <style>{`
        @keyframes stat-spring { 0%{transform:scale(0) translateY(8px);opacity:0} 60%{transform:scale(1.12) translateY(-2px);opacity:1} 80%{transform:scale(0.95) translateY(1px)} 100%{transform:scale(1) translateY(0);opacity:1} }
        .stat-badge{animation:stat-spring 0.5s cubic-bezier(0.34,1.56,0.64,1) both}
        .resize-handle{cursor:col-resize;width:7px;position:absolute;right:0;top:0;bottom:0;background:rgba(139,92,246,0.4);border-radius:0 6px 6px 0;transition:background 0.15s;z-index:5}
        .resize-handle:hover,.clip-strip:hover .resize-handle{background:rgba(139,92,246,0.85)}
        .timeline-scroll::-webkit-scrollbar{height:10px}
        .timeline-scroll::-webkit-scrollbar-track{background:#e2e8f0;border-radius:5px}
        .timeline-scroll::-webkit-scrollbar-thumb{background:#a78bfa;border-radius:5px;border:2px solid #e2e8f0}
        .timeline-scroll::-webkit-scrollbar-thumb:hover{background:#7c3aed}
      `}</style>

      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" style={{display:'none'}}/>}

      {/* ── Top bar ── */}
      <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 flex-shrink-0 z-10">
        <div className="flex items-center gap-2 mr-2">
          <div className="w-8 h-8 bg-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
          </div>
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 font-medium">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 12H5m7-7l-7 7 7 7"/></svg>Back
          </button>
        </div>
        <div className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 cursor-pointer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5 text-gray-500"><rect x="2" y="4" width="20" height="16" rx="2"/></svg>
          Widescreen 16:9
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 text-gray-400 ml-0.5"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div className="flex gap-0.5">
          <button onClick={undo} title="Undo (Ctrl+Z)" className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M3 7v6h6"/><path d="M3 13A9 9 0 1021 12"/></svg></button>
          <button onClick={redo} title="Redo (Ctrl+Y)" className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 7v6h-6"/><path d="M21 13A9 9 0 113 12"/></svg></button>
        </div>
        <div className="flex-1 flex justify-center"><span className="text-sm font-medium text-gray-800">My Video</span></div>
        <div className="flex items-center gap-2">
          {audioUrl&&<div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg"><svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/></svg>{fmtDur(audioDuration??0)}</div>}
          <span className="text-xs text-gray-400 border border-gray-200 rounded-lg px-2.5 py-1.5">{segments.length} scenes · {fmtDur(totalDur)}</span>
          <button className="px-4 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">Share preview</button>
          <button onClick={renderVideo} disabled={rendering} className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg flex items-center gap-2 shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M12 16l-4-4h3V4h2v8h3l-4 4z"/><path d="M4 18h16v2H4z"/></svg>
            {rendering?'Rendering…':'Download'}
          </button>
          <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-xs font-bold">K</div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Icon sidebar */}
        <div className="w-16 bg-white border-r border-gray-200 flex flex-col items-center py-3 gap-1 flex-shrink-0">
          {sidebarTabs.map(({key,label})=>{
            const Icon = SI[key as keyof typeof SI]
            return <button key={key} onClick={()=>setSideTab(key)} className={`w-12 flex flex-col items-center gap-1 py-2 rounded-xl transition-all ${sideTab===key?'bg-purple-50 text-purple-600':'text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}><Icon/><span className="text-[9px] font-medium leading-none">{label}</span></button>
          })}
        </div>

        {/* Content panel */}
        <div className="w-72 bg-white border-r border-gray-200 flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-3 py-2.5 border-b border-gray-100"><span className="text-sm font-semibold text-gray-800 capitalize">{sideTab}</span></div>
          <div className="flex-1 overflow-hidden">{renderSidePanel()}</div>
        </div>

        {/* ── Center ── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">

          {/* Preview */}
          <div className="flex-1 flex items-center justify-center relative px-12 py-6">
            <button onClick={()=>setActiveIdx(i=>Math.max(0,i-1))} disabled={activeIdx===0} className="absolute left-3 w-9 h-9 bg-white rounded-full shadow border border-gray-200 flex items-center justify-center text-gray-600 hover:shadow-md disabled:opacity-30 z-10">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M15 18l-6-6 6-6"/></svg>
            </button>

            <div className="relative bg-black rounded-2xl overflow-hidden shadow-2xl w-full max-w-3xl" style={{aspectRatio:'16/9'}}>
              {chosen ? (
                <>
                  {chosen.videoUrl&&chosen.source!=='youtube'
                    ? <video ref={videoRef} src={chosen.videoUrl} poster={chosen.thumb} className="w-full h-full object-cover" playsInline
                        onTimeUpdate={onTimeUpdate}
                        onLoadedMetadata={e=>setVideoDuration((e.target as HTMLVideoElement).duration)}
                        onEnded={onVideoEnded}/>
                    : <img src={chosen.thumb} alt="preview" className="w-full h-full object-cover"/>
                  }
                  {addCaptions&&activeSeg&&(
                    <div className={`absolute left-0 right-0 px-8 pointer-events-none ${captionStyle.position==='top'?'top-6':captionStyle.position==='center'?'top-1/2 -translate-y-1/2':'bottom-16'}`}>
                      <p className="text-center" style={{fontFamily:captionStyle.font,fontSize:Math.round(captionStyle.fontSize*0.55)+'px',color:captionStyle.color,textShadow:captionStyle.style==='shadow'?'2px 2px 8px rgba(0,0,0,0.9)':'none',fontWeight:captionStyle.style==='bold'?'700':'400',background:captionStyle.style==='box'?captionStyle.bgColor+'cc':'transparent',padding:captionStyle.style==='box'?'4px 16px':'0',borderRadius:'4px',WebkitTextStroke:captionStyle.style==='outline'?`2px ${captionStyle.bgColor}`:'0'}}>
                        {activeSeg.text.replace(/^↳\s*/,'').slice(0,90)}
                      </p>
                    </div>
                  )}
                  {activeSeg?.keywords&&<div className="absolute top-3 right-3 pointer-events-none"><span className="bg-black/50 backdrop-blur-sm text-white text-[10px] px-2 py-0.5 rounded-full">{activeSeg.keywords}</span></div>}
                  {stats.length>0&&(
                    <div className="absolute bottom-16 right-4 flex flex-col items-end gap-3 pointer-events-none">
                      {stats.map((s,i)=><StatBadge key={`${statVer}-${s.id}`} item={s} index={i}/>)}
                    </div>
                  )}
                  {/* Scene duration indicator */}
                  {activeSeg&&videoDuration>0&&activeSeg.duration<videoDuration&&(
                    <div className="absolute top-3 left-3 pointer-events-none">
                      <span className="bg-purple-600/80 backdrop-blur-sm text-white text-[10px] px-2 py-0.5 rounded-full">
                        Cut at {activeSeg.duration}s / {Math.round(videoDuration)}s
                      </span>
                    </div>
                  )}
                  {chosen.videoUrl&&chosen.source!=='youtube'&&(
                    <button onClick={togglePlay} className={`absolute inset-0 flex items-center justify-center transition-opacity ${playing?'opacity-0 hover:opacity-100':'opacity-100'}`}>
                      <div className="w-14 h-14 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center shadow-lg border border-white/20 hover:bg-black/70">
                        {playing?<svg viewBox="0 0 24 24" fill="white" className="w-6 h-6"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>:<svg viewBox="0 0 24 24" fill="white" className="w-6 h-6 ml-1"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
                      </div>
                    </button>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-3 pt-6 pb-2">
                    {chosen.videoUrl&&chosen.source!=='youtube'&&activeSeg&&(
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-white/70 text-[10px] w-8 flex-shrink-0">{fmtSec(videoTime)}</span>
                        <div className="flex-1 relative h-1 bg-white/20 rounded-full overflow-hidden cursor-pointer">
                          {/* Scene duration bar */}
                          <div className="absolute top-0 left-0 h-full bg-white/10 rounded-full" style={{width:`${Math.min(100,(activeSeg.duration/(videoDuration||activeSeg.duration))*100)}%`}}/>
                          <input type="range" min="0" max={activeSeg.duration} step="0.1" value={Math.min(videoTime,activeSeg.duration)} onChange={seek}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" style={{margin:0}}/>
                          <div className="absolute top-0 left-0 h-full bg-purple-400 rounded-full pointer-events-none" style={{width:`${Math.min(100,(videoTime/activeSeg.duration)*100)}%`}}/>
                        </div>
                        <span className="text-white/70 text-[10px] w-8 flex-shrink-0 text-right">{fmtSec(activeSeg.duration)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <p className="text-white text-[11px] truncate max-w-sm">{activeSeg?.text.replace(/^↳\s*/,'').slice(0,70)}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-white/60 text-[10px]">Scene {activeIdx+1}/{segments.length}</span>
                        <span className="text-white/60 text-[10px]">{activeSeg?.duration}s</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 text-gray-600"><path d="M15 10l4.553-2.369A1 1 0 0121 8.5v7a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/></svg></div>
              )}
            </div>

            <button onClick={()=>setActiveIdx(i=>Math.min(segments.length-1,i+1))} disabled={activeIdx===segments.length-1} className="absolute right-3 w-9 h-9 bg-white rounded-full shadow border border-gray-200 flex items-center justify-center text-gray-600 hover:shadow-md disabled:opacity-30 z-10">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>

          {/* Scene info bar */}
          <div className="bg-white border-t border-gray-200 px-4 py-2 flex items-center gap-3 flex-shrink-0">
            <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2.5 py-1 rounded-lg">Scene {activeIdx+1}</span>
            <span className="text-xs text-gray-400">{activeSeg?.duration}s · {activeSeg?.keywords}</span>
            <div className="flex-1"/>
            <span className="text-[10px] text-gray-400">Space = play/pause &nbsp;·&nbsp; Click &amp; drag timeline to scrub</span>
            <span className="text-[10px] text-gray-400">Total: {fmtDur(totalDur)}</span>
          </div>

          {/* ── Timeline ── */}
          <div className="bg-white border-t border-gray-200 flex-shrink-0" style={{height:155}}>

            {/* Timeline toolbar */}
            <div className="flex items-center gap-2 px-3 h-8 border-b border-gray-100 flex-shrink-0">
              <button onClick={toggleGlobalPlay}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${globalPlaying?'bg-red-500 text-white':'bg-purple-600 text-white hover:bg-purple-700'}`}>
                {globalPlaying
                  ? <><svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg> Pause</>
                  : <><svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 ml-0.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play all</>
                }
              </button>
              <div className="w-px h-4 bg-gray-200 mx-1"/>
              <div className="flex items-center gap-1.5">
                <button onClick={()=>setZoom(z=>Math.max(0.25,+(z/1.5).toFixed(2)))} className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-gray-500 hover:border-gray-400 hover:text-gray-700 text-sm font-bold">−</button>
                <span className="text-[10px] text-gray-500 w-10 text-center">{Math.round(zoom*100)}%</span>
                <button onClick={()=>setZoom(z=>Math.min(8,+(z*1.5).toFixed(2)))} className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-gray-500 hover:border-gray-400 hover:text-gray-700 text-sm font-bold">+</button>
                <button onClick={()=>setZoom(1)} className="text-[10px] text-purple-500 hover:text-purple-700 px-1">fit</button>
              </div>
              <div className="flex-1"/>
              <span className="text-[10px] text-gray-400">Total: {fmtDur(totalDur)}</span>
            </div>

            {/* Scrollable ruler + clips */}
            <div
              ref={timelineRef}
              className="timeline-scroll overflow-x-scroll overflow-y-hidden h-full select-none"
              onWheel={onTimelineWheel}
              onMouseDown={onTimelineMouseDown}
              style={{scrollbarWidth:'auto', cursor:'crosshair'}}
            >
              <div style={{width: Math.max(totalDur * pxPerSec + 48, 600), paddingLeft:12, paddingRight:12, paddingTop:0}}>

                {/* Ruler */}
                <div className="relative h-6 flex-shrink-0" style={{width: totalDur * pxPerSec}}>
                  {rulerTicks.map(t => (
                    <div key={t} className="absolute flex flex-col items-start" style={{left: t * pxPerSec}}>
                      <span className="text-[9px] text-gray-400 leading-none mb-0.5">{fmtRulerLabel(t)}</span>
                      <div className="w-px bg-gray-300" style={{height: t % (rulerStep*5)===0 ? 6 : 4}}/>
                    </div>
                  ))}
                  <div className="absolute top-0 bottom-0 pointer-events-none z-20" style={{left: playheadSec * pxPerSec}}>
                    <div className="w-0 h-0" style={{borderLeft:'4px solid transparent',borderRight:'4px solid transparent',borderTop:'6px solid #ef4444',transform:'translateX(-4px)'}}/>
                  </div>
                </div>

                {/* Clips track */}
                <div className="relative flex gap-0.5" style={{width: totalDur * pxPerSec, height:64}}>
                  {segments.map((seg,i) => {
                    const c = seg.clips[seg.chosenIndex]
                    const isActive = i===activeIdx
                    const w = Math.max(24, seg.duration * pxPerSec)
                    return (
                      <div key={i} className={`clip-strip relative flex-shrink-0 rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${isActive?'border-purple-500 shadow-md':reorderOver===i?'border-yellow-400':'border-gray-200 hover:border-gray-400'}`}
                        style={{width:w, height:64}}
                        draggable onDragStart={e=>{e.stopPropagation();handleDragStart(i)}} onDragOver={e=>handleDragOver(e,i)} onDrop={()=>handleDrop(i)} onDragEnd={()=>{setReorderDrag(null);setReorderOver(null)}}
                        onClick={e=>{e.stopPropagation();setActiveIdx(i)}}>
                        {c?.thumb
                          ? <img src={c.thumb} alt="" className="w-full h-full object-cover select-none pointer-events-none"/>
                          : <div className="w-full h-full bg-gray-200 flex items-center justify-center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-gray-400"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
                        }
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 flex items-center justify-between pointer-events-none">
                          <span className="text-[9px] text-white font-medium">{seg.duration}s</span>
                          <span className="text-[9px] text-white/60">{i+1}</span>
                        </div>
                        {isActive&&<div className="absolute top-0 left-0 right-0 h-0.5 bg-purple-500 pointer-events-none"/>}
                        <div className="resize-handle" onMouseDown={e=>onResizeDown(e,i)}/>
                      </div>
                    )
                  })}

                  {/* Playhead line */}
                  <div className="absolute top-0 bottom-0 pointer-events-none z-20" style={{left: playheadSec * pxPerSec}}>
                    <div className="w-0.5 h-full bg-red-500"/>
                  </div>
                </div>

                {/* Voiceover bar */}
                {audioUrl&&(
                  <div className="mt-1 rounded overflow-hidden" style={{height:8, width: totalDur * pxPerSec, background:'#ede9fe'}}>
                    <div className="h-full rounded transition-all duration-100" style={{width:`${playheadPct}%`, background:'linear-gradient(90deg,#8b5cf6,#7c3aed)'}}/>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Render overlay ── */}
      {renderStatus&&(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl">
            {renderStatus.status!=='done'&&renderStatus.status!=='failed'?(
              <><div className="text-center mb-6"><div className="w-14 h-14 rounded-full animate-spin mx-auto mb-4" style={{border:'3px solid #8b5cf6',borderTopColor:'transparent'}}/><p className="text-gray-900 font-semibold text-lg">Rendering your video…</p><p className="text-gray-500 text-sm mt-1">{renderStatus.progressLabel??'Working…'}</p></div><div className="bg-gray-100 rounded-full h-2 overflow-hidden mb-2"><div className="h-full bg-purple-500 rounded-full transition-all duration-500" style={{width:`${renderStatus.progress??0}%`}}/></div><p className="text-center text-xs text-gray-400">{renderStatus.progress??0}% — keep this window open</p></>
            ):renderStatus.status==='done'?(
              <><div className="text-center mb-5"><div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div><p className="text-gray-900 font-semibold text-lg">Render complete!</p><p className="text-gray-400 text-sm mt-1">{fmtDur(renderStatus.duration??0)}</p></div>{renderStatus.url&&<video controls src={renderStatus.url} className="w-full rounded-xl mb-4 max-h-48 bg-black"/>}<div className="flex gap-3"><a href={`/api/download?file=${renderStatus.url?.split('/').pop()}`} download="script2video.mp4" className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-xl text-center">Download MP4</a><button onClick={()=>setRenderStatus(null)} className="px-4 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-xl">Close</button></div></>
            ):(
              <><div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg></div><p className="text-gray-900 font-semibold text-center mb-2">Render failed</p><p className="text-gray-500 text-sm text-center mb-4">{renderStatus.error}</p><button onClick={()=>setRenderStatus(null)} className="w-full py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm">Close</button></>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
