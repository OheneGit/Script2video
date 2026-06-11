export interface VideoClip {
  id: string
  source: 'pexels' | 'pixabay' | 'youtube'
  title: string
  thumb: string
  videoUrl: string
  youtubeId?: string
  duration: number
  width?: number
  height?: number
  tags?: string[]
}

export interface ScriptSegment {
  index: number
  text: string
  keywords: string
  clips: VideoClip[]
  chosenIndex: number
  duration: number
  color: string
  parentIndex?: number
  keywordOptions?: string[]
}

export interface GenerateRequest {
  script: string
  sources: { pexels: boolean; pixabay: boolean; youtube: boolean }
  clipDuration: number
  resultsPerSegment: number
  audioDuration?: number   // if set, clip durations are auto-calculated from this
}

export interface GenerateResponse {
  segments: ScriptSegment[]
  ytInsights: YouTubeInsight[]
  totalDuration: number
}

export interface YouTubeInsight {
  query: string
  results: { videoId: string; title: string; thumb: string; channel: string }[]
}

// ─── Voiceover ──────────────────────────────────────────────────

export interface TTSRequest {
  text: string
  voice: string      // e.g. en-US-AriaNeural
  speed: string      // e.g. +0%, +20%, -20%
  pitch: string      // e.g. +0Hz, +10Hz, -10Hz
}

export interface TTSResponse {
  audioUrl: string   // served from /tts/<filename>.mp3
  duration: number   // seconds
  filename: string
}

export interface TranscribeResponse {
  text: string
  duration: number   // seconds of the audio file
}

// ─── Caption styles ─────────────────────────────────────────────

export interface CaptionStyle {
  font: string          // font name
  fontSize: number      // px
  color: string         // hex
  bgColor: string       // hex or 'none'
  position: 'bottom' | 'top' | 'center'
  style: 'normal' | 'bold' | 'shadow' | 'outline' | 'box'
}

// ─── Render ─────────────────────────────────────────────────────

export interface RenderRequest {
  segments: ScriptSegment[]
  resolution: '1920x1080' | '1280x720' | '3840x2160'
  aspectRatio: '16:9' | '9:16' | '1:1'
  transition: 'cut' | 'fade' | 'zoom'
  addCaptions: boolean
  captionStyle: CaptionStyle
  fps: 25 | 30
  audioFile?: string    // filename in public/tts/ or public/uploads/
  audioMode: 'none' | 'tts' | 'upload'
  notifyEmail?: string  // optional — send email when render is done
}

export interface RenderResponse {
  renderId: string
  status: 'queued' | 'fetching' | 'rendering' | 'done' | 'failed'
  url?: string
  duration?: number
  error?: string
  progress?: number
  progressLabel?: string
}
