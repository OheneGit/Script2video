'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { ScriptSegment, RenderRequest, RenderResponse, CaptionStyle } from '../lib/types'

// ─── Types ─────────────────────────────────────────────────────

interface EditorProps {
  segments: ScriptSegment[]
  totalDuration: number
  audioMode: 'none' | 'tts' | 'upload'
  audioFile?: string
  audioDuration?: number
  audioUrl?: string
  onBack: () => void
}

const CAPTION_FONTS = ['Arial','Impact','Montserrat','Bebas Neue','Oswald','Roboto','Lato','Playfair Display']
const DEFAULT_CAPTION: CaptionStyle = {
  font: 'Arial', fontSize: 48, color: '#ffffff',
  bgColor: '#000000', position: 'bottom', style: 'shadow',
}

function fmtDur(s: number) {
  if (!s || isNaN(s)) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

// ─── Editor Component ──────────────────────────────────────────

export default function VideoEditor({ segments: initialSegments, totalDuration, audioMode, audioFile, audioDuration, audioUrl, onBack }: EditorProps) {
  const [segments, setSegments]           = useState<ScriptSegment[]>(initialSegments)
  const [activeIdx, setActiveIdx]         = useState(0)
  const [addCaptions, setAddCaptions]     = useState(false)
  const [captionStyle, setCaptionStyle]   = useState<CaptionStyle>(DEFAULT_CAPTION)
  const [transition, setTransition]       = useState<'cut'|'fade'|'zoom'>('cut')
  const [resolution, setResolution]       = useState<RenderRequest['resolution']>('1920x1080')
  const [rendering, setRendering]         = useState(false)
  const [renderStatus, setRenderStatus]   = useState<RenderResponse | null>(null)
  const [regenLoading, setRegenLoading]   = useState<number | null>(null)
  const [dragging, setDragging]           = useState<number | null>(null)
  const [dragOver, setDragOver]           = useState<number | null>(null)
  const [showCaptionPanel, setShowCaptionPanel] = useState(false)

  const timelineRef = useRef<HTMLDivElement>(null)
  const activeSeg = segments[activeIdx]
  const totalDur  = segments.reduce((a, s) => a + s.duration, 0)

  // ── Regenerate single segment ──
  const regenerateSegment = async (si: number) => {
    setRegenLoading(si)
    const seg = segments[si]
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: seg.text,
          sources: { pexels: true, pixabay: true, youtube: false },
          clipDuration: seg.duration,
          resultsPerSegment: 8,
        }),
      })
      const data = await res.json()
      if (data.segments?.[0]?.clips?.length > 0) {
        setSegments(prev => prev.map((s, i) =>
          i === si ? { ...s, clips: data.segments[0].clips, chosenIndex: 0 } : s
        ))
      }
    } catch {}
    setRegenLoading(null)
  }

  // ── Swap clip ──
  const swapClip = (si: number, ci: number) => {
    setSegments(prev => prev.map((s, i) => i === si ? { ...s, chosenIndex: ci } : s))
  }

  // ── Adjust duration ──
  const adjustDuration = (si: number, delta: number) => {
    setSegments(prev => prev.map((s, i) =>
      i === si ? { ...s, duration: Math.max(2, s.duration + delta) } : s
    ))
  }

  // ── Drag to reorder timeline ──
  const handleDragStart = (i: number) => setDragging(i)
  const handleDragOver  = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOver(i) }
  const handleDrop      = (i: number) => {
    if (dragging === null || dragging === i) { setDragging(null); setDragOver(null); return }
    const newSegs = [...segments]
    const [moved] = newSegs.splice(dragging, 1)
    newSegs.splice(i, 0, moved)
    setSegments(newSegs)
    setActiveIdx(i)
    setDragging(null)
    setDragOver(null)
  }

  // ── Render ──
  const renderVideo = useCallback(async () => {
    if (rendering) return
    setRendering(true)
    setRenderStatus({ renderId: '', status: 'queued', progress: 0 })

    const req: RenderRequest = {
      segments, resolution,
      aspectRatio: '16:9',
      transition, addCaptions, captionStyle, fps: 25,
      audioMode,
      audioFile,
    }

    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })
      const data: RenderResponse & { error?: string } = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? 'Render error')
      setRenderStatus(data)

      const poll = setInterval(async () => {
        const sr  = await fetch(`/api/status?id=${data.renderId}`)
        const sd: RenderResponse = await sr.json()
        setRenderStatus(sd)
        if (sd.status === 'done' || sd.status === 'failed') {
          clearInterval(poll)
          setRendering(false)
        }
      }, 3000)
    } catch (err: any) {
      alert('Render error: ' + err.message)
      setRendering(false)
    }
  }, [segments, resolution, transition, addCaptions, captionStyle, rendering, audioMode, audioFile])

  const chosen = activeSeg?.clips[activeSeg.chosenIndex]

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">

      {/* ── Top bar ── */}
      <div className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5m7-7l-7 7 7 7"/></svg>
            Back
          </button>
          <div className="w-px h-4 bg-gray-700"/>
          <span className="text-sm font-medium text-white">Script2Video Editor</span>
          <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">{segments.length} clips • {fmtDur(totalDur)}</span>
        </div>
        <div className="flex items-center gap-2">
          {audioUrl && (
            <div className="flex items-center gap-2 text-xs text-green-400 bg-green-900/30 px-3 py-1 rounded">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/></svg>
              Audio attached • {fmtDur(audioDuration ?? 0)}
            </div>
          )}
          <select value={resolution} onChange={e => setResolution(e.target.value as any)}
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded px-2 py-1 outline-none">
            <option value="1920x1080">1080p</option>
            <option value="1280x720">720p</option>
            <option value="3840x2160">4K</option>
          </select>
          <select value={transition} onChange={e => setTransition(e.target.value as any)}
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded px-2 py-1 outline-none">
            <option value="cut">Cut</option>
            <option value="fade">Fade</option>
            <option value="zoom">Zoom</option>
          </select>
          <button onClick={() => setShowCaptionPanel(v => !v)}
            className={`text-xs px-3 py-1 rounded border transition-all ${
              addCaptions ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
            }`}>
            CC Captions
          </button>
          <button onClick={renderVideo} disabled={rendering}
            className="text-xs px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-medium rounded transition-colors flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M15 10l4.553-2.369A1 1 0 0121 8.5v7a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
            </svg>
            {rendering ? 'Rendering...' : 'Render video'}
          </button>
        </div>
      </div>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT: Scene list */}
        <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-3 py-2 border-b border-gray-800 text-xs font-medium text-gray-400 uppercase tracking-wide">
            Scenes ({segments.length})
          </div>
          <div className="flex-1 overflow-y-auto">
            {segments.map((seg, i) => {
              const c = seg.clips[seg.chosenIndex]
              const isActive = i === activeIdx
              const isSubClip = seg.text.startsWith('↳')
              return (
                <div key={i} onClick={() => setActiveIdx(i)}
                  className={`flex gap-2 p-2 cursor-pointer border-b border-gray-800 transition-colors ${
                    isActive ? 'bg-purple-900/40 border-l-2 border-l-purple-500' : 'hover:bg-gray-800'
                  } ${isSubClip ? 'pl-4' : ''}`}>
                  <div className="w-14 h-9 flex-shrink-0 rounded overflow-hidden bg-gray-800">
                    {c?.thumb
                      ? <img src={c.thumb} alt="" className="w-full h-full object-cover" onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/>
                      : <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">▶</div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 leading-snug truncate">
                      {isSubClip ? seg.keywords : (seg.text.length > 50 ? seg.text.slice(0,47)+'…' : seg.text)}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-gray-500">{seg.duration}s</span>
                      {c && <span className={`text-[9px] px-1 rounded ${
                        c.source==='pexels' ? 'bg-blue-900/50 text-blue-300' :
                        c.source==='pixabay' ? 'bg-green-900/50 text-green-300' :
                        'bg-red-900/50 text-red-300'
                      }`}>{c.source}</span>}
                    </div>
                  </div>
                  <span className="text-xs text-gray-600 self-start">{i+1}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* CENTER: Preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 bg-black flex items-center justify-center relative overflow-hidden">
            {chosen?.thumb ? (
              <div className="relative w-full h-full">
                <img src={chosen.thumb} alt="preview"
                  className="w-full h-full object-contain"/>
                {/* Caption preview overlay */}
                {addCaptions && activeSeg && (
                  <div className={`absolute left-0 right-0 px-8 ${
                    captionStyle.position === 'top' ? 'top-8' :
                    captionStyle.position === 'center' ? 'top-1/2 -translate-y-1/2' :
                    'bottom-8'
                  }`}>
                    <p className="text-center" style={{
                      fontFamily: captionStyle.font,
                      fontSize: Math.round(captionStyle.fontSize * 0.6) + 'px',
                      color: captionStyle.color,
                      textShadow: captionStyle.style==='shadow' ? '2px 2px 6px rgba(0,0,0,0.9)' : 'none',
                      fontWeight: captionStyle.style==='bold' ? '700' : '400',
                      background: captionStyle.style==='box' ? captionStyle.bgColor+'cc' : 'transparent',
                      padding: captionStyle.style==='box' ? '4px 16px' : '0',
                      borderRadius: '4px',
                      WebkitTextStroke: captionStyle.style==='outline' ? `2px ${captionStyle.bgColor}` : '0',
                    }}>
                      {activeSeg.text.replace(/^↳\s*/, '').slice(0, 80)}
                    </p>
                  </div>
                )}
                {/* Clip info overlay */}
                <div className="absolute bottom-3 left-3 flex items-center gap-2">
                  <span className="text-xs bg-black/70 text-white px-2 py-0.5 rounded">
                    Scene {activeIdx + 1} / {segments.length}
                  </span>
                  <span className="text-xs bg-black/70 text-white px-2 py-0.5 rounded">
                    {activeSeg?.duration}s
                  </span>
                  {chosen && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      chosen.source==='pexels' ? 'bg-blue-600/80' :
                      chosen.source==='pixabay' ? 'bg-green-600/80' : 'bg-red-600/80'
                    } text-white`}>{chosen.source}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-gray-600 text-sm">No clip selected</div>
            )}
          </div>

          {/* Clip controls bar */}
          {activeSeg && (
            <div className="bg-gray-900 border-t border-gray-800 px-4 py-2 flex items-center gap-3 flex-shrink-0">
              <span className="text-xs text-gray-400 font-medium truncate max-w-xs">
                {activeSeg.text.replace(/^↳\s*/, '').slice(0, 60)}
              </span>
              <div className="flex-1"/>
              {/* Duration controls */}
              <div className="flex items-center gap-1">
                <button onClick={() => adjustDuration(activeIdx, -1)}
                  className="w-6 h-6 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 flex items-center justify-center">−</button>
                <span className="text-xs text-white w-8 text-center">{activeSeg.duration}s</span>
                <button onClick={() => adjustDuration(activeIdx, +1)}
                  className="w-6 h-6 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 flex items-center justify-center">+</button>
              </div>
              {/* Keyword badge */}
              <span className="text-[10px] bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded">{activeSeg.keywords}</span>
              {/* Regenerate */}
              <button onClick={() => regenerateSegment(activeIdx)} disabled={regenLoading === activeIdx}
                className="text-xs px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded flex items-center gap-1.5 transition-colors disabled:opacity-40">
                <svg className={`w-3 h-3 ${regenLoading === activeIdx ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
                {regenLoading === activeIdx ? 'Searching...' : 'New clip'}
              </button>
              {/* Nav */}
              <button onClick={() => setActiveIdx(i => Math.max(0, i-1))} disabled={activeIdx === 0}
                className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded disabled:opacity-30">◀</button>
              <button onClick={() => setActiveIdx(i => Math.min(segments.length-1, i+1))} disabled={activeIdx === segments.length-1}
                className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded disabled:opacity-30">▶</button>
            </div>
          )}
        </div>

        {/* RIGHT: Clip alternatives */}
        <div className="w-52 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-3 py-2 border-b border-gray-800 text-xs font-medium text-gray-400 uppercase tracking-wide">
            Alternatives ({activeSeg?.clips.length ?? 0})
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {activeSeg?.clips.map((c, ci) => (
              <div key={ci} onClick={() => swapClip(activeIdx, ci)}
                className={`rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                  ci === activeSeg.chosenIndex ? 'border-purple-500' : 'border-transparent hover:border-gray-600'
                }`}>
                <div className="relative">
                  <img src={c.thumb} alt="" className="w-full h-20 object-cover"
                    onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/>
                  {ci === activeSeg.chosenIndex && (
                    <div className="absolute top-1 right-1 w-4 h-4 bg-purple-500 rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                    </div>
                  )}
                </div>
                <div className="p-1.5 bg-gray-800">
                  <div className="flex items-center justify-between">
                    <span className={`text-[9px] px-1 rounded ${
                      c.source==='pexels' ? 'bg-blue-900/70 text-blue-300' :
                      c.source==='pixabay' ? 'bg-green-900/70 text-green-300' :
                      'bg-red-900/70 text-red-300'
                    }`}>{c.source}</span>
                    <span className="text-[9px] text-gray-500">{c.duration}s</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Caption panel (slides down) ── */}
      {showCaptionPanel && (
        <div className="bg-gray-900 border-t border-gray-800 px-4 py-3 flex items-center gap-6 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Captions</span>
            <button onClick={() => setAddCaptions(v=>!v)}
              className={`w-8 h-4 rounded-full transition-colors relative ${addCaptions ? 'bg-purple-600' : 'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${addCaptions?'left-4':'left-0.5'}`}/>
            </button>
          </div>
          {addCaptions && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Font</span>
                <select value={captionStyle.font} onChange={e=>setCaptionStyle(s=>({...s,font:e.target.value}))}
                  className="text-xs bg-gray-800 text-white border border-gray-700 rounded px-2 py-1 outline-none">
                  {CAPTION_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Style</span>
                <div className="flex gap-1">
                  {(['normal','bold','shadow','outline','box'] as const).map(st => (
                    <button key={st} onClick={() => setCaptionStyle(s=>({...s,style:st}))}
                      className={`text-[10px] px-2 py-0.5 rounded capitalize ${
                        captionStyle.style===st ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}>{st}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Size</span>
                <input type="range" min="24" max="96" step="4" value={captionStyle.fontSize}
                  onChange={e=>setCaptionStyle(s=>({...s,fontSize:+e.target.value}))} className="w-20"/>
                <span className="text-xs text-gray-400">{captionStyle.fontSize}px</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Position</span>
                {(['top','center','bottom'] as const).map(p => (
                  <button key={p} onClick={() => setCaptionStyle(s=>({...s,position:p}))}
                    className={`text-[10px] px-2 py-0.5 rounded capitalize ${
                      captionStyle.position===p ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}>{p}</button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Color</span>
                <input type="color" value={captionStyle.color}
                  onChange={e=>setCaptionStyle(s=>({...s,color:e.target.value}))}
                  className="w-6 h-6 rounded cursor-pointer border-0"/>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Timeline ── */}
      <div className="bg-gray-900 border-t border-gray-800 flex-shrink-0" style={{ height: '120px' }}>
        <div className="px-3 py-1.5 flex items-center justify-between border-b border-gray-800">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">Timeline — drag to reorder</span>
          <span className="text-[10px] text-gray-500">{fmtDur(totalDur)} total</span>
        </div>
        <div ref={timelineRef} className="flex gap-1 px-3 py-2 overflow-x-auto h-full items-center">
          {segments.map((seg, i) => {
            const c = seg.clips[seg.chosenIndex]
            const isActive = i === activeIdx
            const minW = Math.max(40, seg.duration * 8)
            return (
              <div
                key={i}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={e => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={() => { setDragging(null); setDragOver(null) }}
                onClick={() => setActiveIdx(i)}
                className={`flex-shrink-0 rounded cursor-pointer border-2 transition-all relative overflow-hidden ${
                  isActive ? 'border-purple-500 shadow-lg shadow-purple-900/50' :
                  dragOver === i ? 'border-yellow-400' : 'border-transparent hover:border-gray-600'
                }`}
                style={{ width: minW, height: '72px' }}
              >
                {c?.thumb ? (
                  <img src={c.thumb} alt="" className="w-full h-full object-cover opacity-80"/>
                ) : (
                  <div className="w-full h-full flex items-center justify-center"
                    style={{ background: seg.color, opacity: 0.8 }}>
                    <span className="text-white text-[9px] font-medium">{seg.duration}s</span>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 flex items-center justify-between">
                  <span className="text-[8px] text-white truncate">{i+1}</span>
                  <span className="text-[8px] text-gray-300">{seg.duration}s</span>
                </div>
                {isActive && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-purple-500"/>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Render status overlay ── */}
      {renderStatus && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-full max-w-md">
            {renderStatus.status !== 'done' && renderStatus.status !== 'failed' ? (
              <>
                <div className="text-center mb-6">
                  <div className="w-12 h-12 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"/>
                  <p className="text-white font-medium">Rendering your video...</p>
                  <p className="text-gray-400 text-sm mt-1">{renderStatus.progressLabel ?? 'Working...'}</p>
                </div>
                <div className="bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div className="h-full bg-purple-500 rounded-full transition-all duration-500"
                    style={{ width: `${renderStatus.progress ?? 0}%` }}/>
                </div>
                <p className="text-center text-xs text-gray-500 mt-2">{renderStatus.progress ?? 0}% — keep this window open</p>
              </>
            ) : renderStatus.status === 'done' ? (
              <>
                <div className="text-center mb-4">
                  <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                  </div>
                  <p className="text-white font-medium text-lg">Render complete!</p>
                  <p className="text-gray-400 text-sm mt-1">{fmtDur(renderStatus.duration ?? 0)} • free via FFmpeg</p>
                </div>
                {renderStatus.url && (
                  <video controls src={renderStatus.url} className="w-full rounded-lg mb-4 max-h-48 bg-black"/>
                )}
                <div className="flex gap-3">
                  <a href={`/api/download?file=${renderStatus.url.split("/").pop()}`} download="script2video.mp4"
                    className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg text-center transition-colors">
                    Download MP4
                  </a>
                  <button onClick={() => setRenderStatus(null)}
                    className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-red-400 font-medium mb-2">Render failed</p>
                <p className="text-gray-400 text-sm mb-4">{renderStatus.error}</p>
                <button onClick={() => setRenderStatus(null)}
                  className="w-full py-2 bg-gray-800 text-gray-300 rounded-lg text-sm">Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

