'use client'

import { useState, useCallback, useRef } from 'react'
import VideoEditor from './editor/VideoEditor'
import type { ScriptSegment, GenerateResponse, RenderResponse, RenderRequest, CaptionStyle } from './lib/types'

function fmtDur(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

const SOURCE_BADGE: Record<string, string> = {
  pexels:  'bg-blue-50 text-blue-800',
  pixabay: 'bg-green-50 text-green-800',
  youtube: 'bg-red-50 text-red-800',
}

const TTS_VOICES = [
  { value: 'en-US-AriaNeural',    label: '🇺🇸 Aria (Female) — warm, natural' },
  { value: 'en-US-GuyNeural',     label: '🇺🇸 Guy (Male) — deep, professional' },
  { value: 'en-US-JennyNeural',   label: '🇺🇸 Jenny (Female) — friendly' },
  { value: 'en-US-DavisNeural',   label: '🇺🇸 Davis (Male) — confident' },
  { value: 'en-GB-SoniaNeural',   label: '🇬🇧 Sonia (Female) — crisp, clear' },
  { value: 'en-GB-RyanNeural',    label: '🇬🇧 Ryan (Male) — smooth' },
  { value: 'en-NG-EzinneNeural',  label: '🇳🇬 Ezinne (Female) — Nigerian' },
  { value: 'en-NG-AbeoNeural',    label: '🇳🇬 Abeo (Male) — Nigerian' },
  { value: 'en-GH-NanaNeural',    label: '🇬🇭 Nana (Female) — Ghanaian' },
  { value: 'en-GH-AmaNeural',     label: '🇬🇭 Ama (Female) — Ghanaian' },
  { value: 'en-AU-NatashaNeural', label: '🇦🇺 Natasha (Female) — Australian' },
  { value: 'en-CA-ClaraNeural',   label: '🇨🇦 Clara (Female) — Canadian' },
]

const CAPTION_FONTS = ['Arial','Impact','Montserrat','Bebas Neue','Oswald','Roboto','Lato','Playfair Display']
const CAPTION_STYLES = ['normal','bold','outline','shadow','box'] as const

const DEFAULT_CAPTION: CaptionStyle = {
  font: 'Arial', fontSize: 48, color: '#ffffff',
  bgColor: '#000000', position: 'bottom', style: 'shadow',
}

export default function Home() {
  const [script, setScript]               = useState('')
  const [sources, setSources]             = useState({ pexels: true, pixabay: true, youtube: false })
  const [clipDuration, setClipDuration]   = useState(6)
  const [resultsPerSeg, setResultsPerSeg] = useState(5)

  // Audio mode — always starts as 'none', never persists old state
  const [audioMode, setAudioMode]         = useState<'none' | 'tts' | 'upload'>('none')

  // TTS
  const [ttsVoice, setTtsVoice]           = useState('en-US-AriaNeural')
  const [ttsSpeed, setTtsSpeed]           = useState('+0%')
  const [ttsPitch, setTtsPitch]           = useState('+0Hz')
  const [ttsLoading, setTtsLoading]       = useState(false)
  const [ttsAudio, setTtsAudio]           = useState<{ url: string; filename: string; duration: number } | null>(null)
  const [ttsError, setTtsError]           = useState('')

  // Upload — completely fresh state every time
  const [uploadedAudio, setUploadedAudio] = useState<{ url: string; filename: string; duration: number; name: string } | null>(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadError, setUploadError]     = useState('')
  const [transcribing, setTranscribing]   = useState(false)
  const [transcribedText, setTranscribedText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Caption
  const [addCaptions, setAddCaptions]     = useState(false)
  const [captionStyle, setCaptionStyle]   = useState<CaptionStyle>(DEFAULT_CAPTION)

  // Output
  const [transition, setTransition]       = useState<'cut'|'fade'|'zoom'>('cut')
  const [resolution, setResolution]       = useState<RenderRequest['resolution']>('1920x1080')
  const [aspectRatio, setAspectRatio]     = useState<RenderRequest['aspectRatio']>('16:9')

  // Results
  const [loading, setLoading]             = useState(false)
  const [progress, setProgress]           = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [segments, setSegments]           = useState<ScriptSegment[]>([])
  const [totalDur, setTotalDur]           = useState(0)
  const [renderStatus, setRenderStatus]   = useState<RenderResponse | null>(null)
  const [rendering, setRendering]         = useState(false)
  const [showEditor, setShowEditor]         = useState(false)

  const segCount = script.replace(/\n+/g,' ').split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20).length

  // Switch audio mode — always clear old state
  const switchAudioMode = (mode: 'none' | 'tts' | 'upload') => {
    setAudioMode(mode)
    // Clear all audio state when switching
    setUploadedAudio(null)
    setUploadError('')
    setTranscribedText('')
    setTtsAudio(null)
    setTtsError('')
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Generate TTS
  const generateTTS = async () => {
    if (!script.trim()) { setTtsError('Paste your script first.'); return }
    setTtsLoading(true); setTtsError('')
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script, voice: ttsVoice, speed: ttsSpeed, pitch: ttsPitch }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'TTS failed')
      setTtsAudio({ url: data.audioUrl, filename: data.filename, duration: data.duration })
    } catch (err: any) {
      setTtsError(err.message)
    } finally {
      setTtsLoading(false)
    }
  }

  // Upload audio — always fresh
  const handleAudioUpload = async (file: File) => {
    // Reset everything first
    setUploadedAudio(null)
    setUploadError('')
    setTranscribedText('')
    setUploadLoading(true)

    try {
      const fd = new FormData()
      fd.append('audio', file)
      const res = await fetch('/api/upload-audio', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Upload failed')

      console.log(`Uploaded: ${data.originalName} | Duration: ${data.duration}s`)

      // Set fresh audio data
      setUploadedAudio({
        url: data.audioUrl + '?t=' + Date.now(), // cache bust
        filename: data.filename,
        duration: data.duration,
        name: file.name,
      })

      // Auto-transcribe if no script
      if (!script.trim()) {
        setTranscribing(true)
        try {
          const tr = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: data.filename }),
          })
          const td = await tr.json()
          if (td.text) { setScript(td.text); setTranscribedText(td.text) }
          if (td.warning) setUploadError(td.warning)
        } catch {}
        setTranscribing(false)
      }
    } catch (err: any) {
      setUploadError(err.message)
    } finally {
      setUploadLoading(false)
    }
  }

  // Generate clips
  const generate = useCallback(async () => {
    if (loading || script.trim().length < 20) return
    setLoading(true); setProgress(10); setProgressLabel('Calling video search APIs...')
    setSegments([]); setRenderStatus(null)

    let audioDuration: number | undefined
    if (audioMode === 'tts' && ttsAudio) audioDuration = ttsAudio.duration
    if (audioMode === 'upload' && uploadedAudio) audioDuration = uploadedAudio.duration

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script, sources, clipDuration, resultsPerSegment: resultsPerSeg, audioDuration }),
      })
      setProgress(80); setProgressLabel('Processing results...')
      const data: GenerateResponse & { error?: string } = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? 'API error')
      setSegments(data.segments)
      setTotalDur(data.totalDuration)
      setProgress(100); setProgressLabel('Done!')
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setLoading(false)
      setTimeout(() => setProgress(0), 1200)
    }
  }, [script, sources, clipDuration, resultsPerSeg, loading, audioMode, ttsAudio, uploadedAudio])

  const swapClip = (si: number, ci: number) =>
    setSegments(prev => prev.map((s, i) => i === si ? { ...s, chosenIndex: ci } : s))

  const reSearchSegment = async (si: number, keyword: string) => {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: keyword + '.', sources, clipDuration: segments[si].duration, resultsPerSegment: resultsPerSeg }),
    })
    const data = await res.json()
    if (data.segments?.[0]?.clips?.length > 0) {
      setSegments(prev => prev.map((s, i) => i === si ? { ...s, keywords: keyword, clips: data.segments[0].clips, chosenIndex: 0 } : s))
    }
  }

  // Render
  const renderVideo = useCallback(async () => {
    if (rendering || segments.length === 0) return
    setRendering(true); setRenderStatus({ renderId: '', status: 'queued', progress: 0 })

    const activeAudio = audioMode === 'tts' ? ttsAudio : audioMode === 'upload' ? uploadedAudio : null

    const req: RenderRequest = {
      segments, resolution, aspectRatio, transition, addCaptions, captionStyle, fps: 25,
      audioMode,
      audioFile: activeAudio?.filename,
    }

    try {
      const res = await fetch('/api/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })
      const data: RenderResponse & { error?: string } = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? 'Render error')
      setRenderStatus(data)

      const poll = setInterval(async () => {
        const sr = await fetch(`/api/status?id=${data.renderId}`)
        const sd: RenderResponse = await sr.json()
        setRenderStatus(sd)
        if (sd.status === 'done' || sd.status === 'failed') {
          clearInterval(poll); setRendering(false)
        }
      }, 3000)
    } catch (err: any) {
      alert('Render error: ' + err.message); setRendering(false)
    }
  }, [segments, resolution, aspectRatio, transition, addCaptions, captionStyle, rendering, audioMode, ttsAudio, uploadedAudio])

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 flex items-center justify-between h-14 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-400 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M4 8h16v12H4V8zm3-5v3m10-3v3M9 14l2 2 4-4"/></svg>
          </div>
          <span className="font-medium text-gray-900 text-[15px]">Script<span className="text-brand-400">2</span>Video</span>
        </div>
        <span className="text-xs bg-brand-50 text-brand-600 px-3 py-1 rounded-full font-medium">Pexels · Pixabay · Edge TTS · FFmpeg</span>
      </nav>

      <div className="text-center py-8 px-4">
        <h1 className="text-3xl font-medium text-gray-900 mb-2">Script → AI Voiceover → <span className="text-brand-400">Video</span></h1>
        <p className="text-gray-500 text-[15px] max-w-xl mx-auto">Paste your script, pick a voice, find stock clips, render a full video — completely free.</p>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 pb-16 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">

          {/* Script */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-900">Script</p><p className="text-xs text-gray-400">One sentence per video segment</p></div>
              <span className="text-xs text-gray-400"><strong className="text-brand-400">{segCount}</strong> segments</span>
            </div>
            <div className="p-4">
              <textarea
                className="w-full border border-gray-200 rounded-lg p-3 text-sm text-gray-800 bg-gray-50 resize-y min-h-[160px] leading-relaxed outline-none focus:border-brand-400 placeholder-gray-400"
                placeholder="Paste your script here..."
                value={script}
                onChange={e => setScript(e.target.value)}
              />
              {loading && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-400 mb-1"><span>{progressLabel}</span><span>{progress}%</span></div>
                  <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-400 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}/>
                  </div>
                </div>
              )}
              <div className="mt-3 flex justify-end">
                <button onClick={generate} disabled={loading || script.trim().length < 20}
                  className="px-5 py-2 bg-brand-400 hover:bg-brand-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {loading ? 'Searching...' : 'Find matching videos'}
                </button>
                {segments.length > 0 && !loading && (
                  <button onClick={() => setShowEditor(true)}
                    className="px-5 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                    </svg>
                    Open Editor
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Voiceover */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-900">Voiceover</p>
              <p className="text-xs text-gray-400">Add audio to your final video</p>
            </div>
            <div className="p-4">
              <div className="flex gap-2 mb-4">
                {([['none','No audio'],['tts','AI voiceover'],['upload','Upload my own']] as const).map(([m, label]) => (
                  <button key={m} onClick={() => switchAudioMode(m)}
                    className={`flex-1 text-xs py-2 px-3 rounded-lg border transition-all font-medium ${
                      audioMode === m ? 'bg-brand-50 text-brand-600 border-brand-200' : 'border-gray-200 text-gray-400 hover:border-gray-300'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>

              {audioMode === 'tts' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1.5">Voice</label>
                    <select value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-800 outline-none">
                      {TTS_VOICES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1.5">Speed</label>
                      <select value={ttsSpeed} onChange={e => setTtsSpeed(e.target.value)}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-800 outline-none">
                        <option value="-20%">Slow</option>
                        <option value="+0%">Normal</option>
                        <option value="+20%">Fast</option>
                        <option value="+40%">Very fast</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1.5">Pitch</label>
                      <select value={ttsPitch} onChange={e => setTtsPitch(e.target.value)}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-800 outline-none">
                        <option value="-10Hz">Low</option>
                        <option value="+0Hz">Normal</option>
                        <option value="+10Hz">High</option>
                      </select>
                    </div>
                  </div>
                  <button onClick={generateTTS} disabled={ttsLoading || !script.trim()}
                    className="w-full py-2.5 bg-brand-400 hover:bg-brand-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
                    {ttsLoading ? 'Generating voiceover...' : 'Generate AI voiceover'}
                  </button>
                  {ttsError && <p className="text-xs text-red-500 bg-red-50 rounded-lg p-2">{ttsError}</p>}
                  {ttsAudio && (
                    <div className="border border-green-200 bg-green-50 rounded-lg p-3">
                      <p className="text-xs text-green-700 font-medium mb-2">✅ Voiceover ready — {fmtDur(ttsAudio.duration)}</p>
                      <audio controls src={ttsAudio.url} className="w-full h-8"/>
                    </div>
                  )}
                </div>
              )}

              {audioMode === 'upload' && (
                <div className="space-y-3">
                  <div onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-brand-400 transition-colors">
                    <p className="text-sm text-gray-500">{uploadLoading ? 'Uploading...' : 'Click to upload MP3, WAV, M4A'}</p>
                    <p className="text-xs text-gray-400 mt-1">Your voiceover will sync with the video clips</p>
                    <input ref={fileInputRef} type="file" accept="audio/*" className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) {
                          // Reset input value so same file can be re-uploaded
                          e.target.value = ''
                          handleAudioUpload(f)
                        }
                      }}/>
                  </div>
                  {uploadError && <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2">{uploadError}</p>}
                  {transcribing && <p className="text-xs text-gray-500 animate-pulse">Transcribing audio with Whisper...</p>}
                  {uploadedAudio && (
                    <div className="border border-green-200 bg-green-50 rounded-lg p-3">
                      <p className="text-xs text-green-700 font-medium mb-2">✅ {uploadedAudio.name} — {fmtDur(uploadedAudio.duration)}</p>
                      <audio controls src={uploadedAudio.url} className="w-full h-8"/>
                      {transcribedText && <p className="text-xs text-gray-500 mt-2 italic">Auto-transcribed and added to script above</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Segment cards */}
          {segments.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide px-1">{segments.length} clips matched</p>
              {segments.map((seg, si) => {
                const chosen = seg.clips[seg.chosenIndex]
                const isSubClip = seg.text.startsWith('↳')
                return (
                  <div key={si} className={`bg-white border rounded-xl overflow-hidden ${isSubClip ? 'border-gray-100 ml-5' : 'border-gray-200'}`}>
                    {!isSubClip && (
                      <div className="px-3 pt-2.5 pb-1">
                        <p className="text-xs text-gray-700 leading-snug font-medium">
                          {seg.text.length > 120 ? seg.text.slice(0,117)+'…' : seg.text}
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-[80px_1fr]">
                      {chosen?.thumb
                        ? <img src={chosen.thumb} alt="clip" className="w-20 h-14 object-cover" onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/>
                        : <div className="w-20 h-14 bg-gray-100 flex items-center justify-center text-gray-300">▶</div>
                      }
                      <div className="p-2.5">
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {chosen && <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${SOURCE_BADGE[chosen.source]}`}>{chosen.source}</span>}
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{seg.duration}s</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 max-w-[160px] truncate">{seg.keywords}</span>
                          {seg.clips.length > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">{seg.clips.length} clips</span>}
                        </div>
                        {seg.clips.length > 1 && (
                          <div className="flex gap-1 flex-wrap">
                            {seg.clips.slice(0,5).map((c,ci) => (
                              <img key={ci} src={c.thumb} alt="alt" onClick={() => swapClip(si,ci)}
                                className={`w-12 h-8 object-cover rounded cursor-pointer transition-all ${ci===seg.chosenIndex?'ring-2 ring-brand-400':'opacity-50 hover:opacity-100'}`}
                                onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/>
                            ))}
                          </div>
                        )}
                        {seg.keywordOptions && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {seg.keywordOptions.filter(k=>k!==seg.keywords).slice(0,3).map((kw,ki) => (
                              <button key={ki} onClick={() => reSearchSegment(si,kw)}
                                className="text-[9px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:border-brand-400 hover:text-brand-600 transition-all">
                                {kw.length>22?kw.slice(0,20)+'…':kw}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Timeline */}
          {segments.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-900">Timeline</span>
                <span className="text-xs text-gray-400">{fmtDur(totalDur)} total</span>
              </div>
              <div className="flex gap-1 h-10 flex-wrap">
                {segments.map((seg,i) => (
                  <div key={i} className="rounded flex items-center justify-center text-[9px] text-white font-medium min-w-[24px]"
                    style={{ flex: seg.duration, background: seg.color }} title={seg.text.slice(0,50)}>
                    {seg.duration}s
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Render status */}
          <div className="mt-6">
          {renderStatus && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  renderStatus.status==='done' ? 'bg-green-500' : renderStatus.status==='failed' ? 'bg-red-500' : 'bg-amber-400 animate-pulse'
                }`}/>
                <span className="text-sm font-medium text-gray-900">
                  {renderStatus.status==='fetching'  ? 'Downloading clips...' :
                   renderStatus.status==='rendering' ? 'Rendering with FFmpeg...' :
                   renderStatus.status==='queued'    ? 'Queued...' :
                   renderStatus.status==='done'      ? 'Render complete!' : 'Failed'}
                </span>
              </div>
              {renderStatus.status!=='done' && renderStatus.status!=='failed' && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>{renderStatus.progressLabel ?? 'Working...'}</span>
                    <span>{renderStatus.progress ?? 0}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-400 rounded-full transition-all duration-500" style={{ width: `${renderStatus.progress ?? 0}%` }}/>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Running locally — keep this tab open.</p>
                </div>
              )}
              {renderStatus.status==='done' && renderStatus.url && (
                <div>
                  <video controls src={renderStatus.url} className="w-full rounded-lg mb-3 max-h-72 bg-black"/>
                  <div className="flex gap-2 flex-wrap">
                    <a href={renderStatus.url} download="script2video.mp4"
                      className="px-4 py-2 bg-brand-400 text-white text-sm font-medium rounded-lg hover:bg-brand-600">
                      Download MP4
                    </a>
                    {renderStatus.duration && <span className="text-xs text-gray-400 self-center">{fmtDur(renderStatus.duration)} • free via FFmpeg</span>}
                  </div>
                </div>
              )}
              {renderStatus.status==='failed' && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">
                  <p className="font-medium mb-1">Render failed</p>
                  <p>{renderStatus.error ?? 'Unknown error.'}</p>
                </div>
              )}
            </div>
          )}
          </div>
        </div>

        {/* RIGHT */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Video sources</p>
            <div className="flex flex-wrap gap-2">
              {(['pexels','pixabay','youtube'] as const).map(src => (
                <button key={src} onClick={() => setSources(s=>({...s,[src]:!s[src]}))}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                    sources[src] ? 'bg-brand-50 text-brand-600 border-brand-200 font-medium' : 'border-gray-200 text-gray-400'
                  }`}>
                  {src === 'youtube' ? 'YouTube CC' : src.charAt(0).toUpperCase()+src.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Clip settings</p>
            <div>
              <div className="flex justify-between mb-1"><label className="text-xs text-gray-500">Max clip length (cut speed)</label><span className="text-xs font-medium text-gray-700">{clipDuration}s</span></div>
              <input type="range" min="3" max="15" step="1" value={clipDuration} onChange={e=>setClipDuration(+e.target.value)} className="w-full"/>
            </div>
            <div>
              <div className="flex justify-between mb-1"><label className="text-xs text-gray-500">Results per segment</label><span className="text-xs font-medium text-gray-700">{resultsPerSeg}</span></div>
              <input type="range" min="3" max="10" step="1" value={resultsPerSeg} onChange={e=>setResultsPerSeg(+e.target.value)} className="w-full"/>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Captions</p>
              <button onClick={() => setAddCaptions(v=>!v)}
                className={`w-10 h-5 rounded-full transition-colors relative ${addCaptions ? 'bg-brand-400' : 'bg-gray-200'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${addCaptions?'left-5':'left-0.5'}`}/>
              </button>
            </div>
            {addCaptions && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1.5">Font</label>
                  <select value={captionStyle.font} onChange={e=>setCaptionStyle(s=>({...s,font:e.target.value}))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-800 outline-none">
                    {CAPTION_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1.5">Style</label>
                  <div className="flex flex-wrap gap-1.5">
                    {CAPTION_STYLES.map(st => (
                      <button key={st} onClick={() => setCaptionStyle(s=>({...s,style:st}))}
                        className={`text-xs px-2.5 py-1 rounded-lg border capitalize transition-all ${
                          captionStyle.style===st ? 'bg-brand-50 text-brand-600 border-brand-200 font-medium' : 'border-gray-200 text-gray-400'
                        }`}>{st}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1"><label className="text-xs text-gray-500">Font size</label><span className="text-xs font-medium text-gray-700">{captionStyle.fontSize}px</span></div>
                  <input type="range" min="24" max="96" step="4" value={captionStyle.fontSize} onChange={e=>setCaptionStyle(s=>({...s,fontSize:+e.target.value}))} className="w-full"/>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1.5">Position</label>
                  <div className="flex gap-1.5">
                    {(['top','center','bottom'] as const).map(p => (
                      <button key={p} onClick={() => setCaptionStyle(s=>({...s,position:p}))}
                        className={`flex-1 text-xs py-1.5 rounded-lg border capitalize transition-all ${
                          captionStyle.position===p ? 'bg-brand-50 text-brand-600 border-brand-200 font-medium' : 'border-gray-200 text-gray-400'
                        }`}>{p}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Text color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={captionStyle.color} onChange={e=>setCaptionStyle(s=>({...s,color:e.target.value}))} className="w-8 h-8 rounded cursor-pointer border border-gray-200"/>
                      <span className="text-xs text-gray-500">{captionStyle.color}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">BG color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={captionStyle.bgColor} onChange={e=>setCaptionStyle(s=>({...s,bgColor:e.target.value}))} className="w-8 h-8 rounded cursor-pointer border border-gray-200"/>
                      <span className="text-xs text-gray-500">{captionStyle.bgColor}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg bg-gray-900 h-16 flex items-end justify-center pb-3 overflow-hidden">
                  <span style={{
                    fontFamily: captionStyle.font,
                    fontSize: Math.round(captionStyle.fontSize * 0.35) + 'px',
                    color: captionStyle.color,
                    textShadow: captionStyle.style==='shadow' ? '2px 2px 4px rgba(0,0,0,0.9)' : 'none',
                    fontWeight: captionStyle.style==='bold' ? '700' : '400',
                    background: captionStyle.style==='box' ? captionStyle.bgColor+'cc' : 'transparent',
                    padding: captionStyle.style==='box' ? '2px 8px' : '0',
                    borderRadius: '3px',
                  }}>Caption preview text</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Output</p>
            <div>
              <label className="text-xs text-gray-500 block mb-1.5">Resolution</label>
              <select value={resolution} onChange={e=>setResolution(e.target.value as RenderRequest['resolution'])}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-800 outline-none">
                <option value="3840x2160">4K (3840×2160)</option>
                <option value="1920x1080">1080p Full HD</option>
                <option value="1280x720">720p HD</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1.5">Aspect ratio</label>
              <div className="flex gap-2">
                {(['16:9','9:16','1:1'] as const).map(ar => (
                  <button key={ar} onClick={() => setAspectRatio(ar)}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${
                      aspectRatio===ar ? 'bg-brand-50 text-brand-600 border-brand-200 font-medium' : 'border-gray-200 text-gray-400'
                    }`}>{ar}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1.5">Transition</label>
              <div className="flex gap-2">
                {(['cut','fade','zoom'] as const).map(t => (
                  <button key={t} onClick={() => setTransition(t)}
                    className={`flex-1 text-xs py-1.5 rounded-lg border capitalize transition-all ${
                      transition===t ? 'bg-brand-50 text-brand-600 border-brand-200 font-medium' : 'border-gray-200 text-gray-400'
                    }`}>{t}</button>
                ))}
              </div>
            </div>
          </div>

          {segments.length > 0 && (
            <button onClick={renderVideo} disabled={rendering}
              className="w-full py-3 bg-brand-400 hover:bg-brand-600 disabled:opacity-40 text-white text-sm font-medium rounded-xl flex items-center justify-center gap-2 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M15 10l4.553-2.369A1 1 0 0121 8.5v7a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
              </svg>
              {rendering ? 'Rendering…' : 'Render video'}
            </button>
          )}

          {segments.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Stats</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { v: segments.reduce((a,s)=>a+s.clips.length,0), l: 'Clips found' },
                  { v: [...new Set(segments.flatMap(s=>s.clips.map(c=>c.source)))].length, l: 'Sources' },
                  { v: fmtDur(totalDur), l: 'Duration' },
                ].map(({v,l}) => (
                  <div key={l} className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-lg font-medium text-gray-900">{v}</div>
                    <div className="text-[10px] text-gray-400">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* ── Editor overlay ── */}
    {showEditor && segments.length > 0 && (
      <div className="fixed inset-0 z-50">
        <VideoEditor
          segments={segments}
          totalDuration={totalDur}
          audioMode={audioMode}
          audioFile={audioMode === 'tts' ? ttsAudio?.filename : uploadedAudio?.filename}
          audioDuration={audioMode === 'tts' ? ttsAudio?.duration : uploadedAudio?.duration}
          audioUrl={audioMode === 'tts' ? ttsAudio?.url : uploadedAudio?.url}
          onBack={() => setShowEditor(false)}
        />
      </div>
    )}
  )
}
