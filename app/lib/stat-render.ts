/**
 * Renders animated stat overlays (count-up, glow, spring pop-in) as PNG frame
 * sequences using a headless Puppeteer browser with Canvas API.
 * These frames are then composited onto video clips by FFmpeg.
 */

import fs from 'fs'
import path from 'path'

type StatType = 'percent' | 'year' | 'date' | 'money' | 'figure'

export interface StatData {
  type: StatType
  raw: string
  numericTarget?: number
  dateSequence?: string[]
}

const GLOW_COLORS: Record<StatType, string> = {
  percent: '#a78bfa',
  year:    '#38bdf8',
  date:    '#34d399',
  money:   '#fbbf24',
  figure:  '#f87171',
}
const LABELS: Record<StatType, string> = {
  percent: 'RATE', year: 'YEAR', date: 'DATE', money: 'AMOUNT', figure: 'FIGURE',
}

// ── Server-side stat extraction (mirrors client extractStats) ────
export function extractStatsServer(text: string): StatData[] {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const items: StatData[] = []
  const seen = new Set<string>()
  const push = (raw: string, type: StatType, extra?: Partial<StatData>) => {
    const k = raw.toLowerCase().trim(); if (seen.has(k)) return; seen.add(k)
    items.push({ raw: raw.trim(), type, ...extra })
  }
  const parseN = (s: string) => {
    const c = s.replace(/[$£€₦₵¥,\s]/g, ''), m = c.match(/^([\d.]+)([a-z]*)$/i)
    if (!m) return undefined
    const mult: Record<string,number> = {k:1e3,m:1e6,b:1e9,t:1e12,thousand:1e3,million:1e6,billion:1e9,trillion:1e12}
    return parseFloat(m[1]) * (mult[m[2].toLowerCase()] ?? 1)
  }
  Array.from(text.matchAll(/[$£€₦₵¥]\s*[\d,]+(?:\.\d+)?(?:\s*[BMKbmk](?:illion)?)?/g))
    .forEach(m => push(m[0].trim(), 'money', { numericTarget: parseN(m[0]) }))
  Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*%/g))
    .forEach(m => push(m[0].trim(), 'percent', { numericTarget: parseFloat(m[1]) }))
  const capturedYears = new Set<string>()
  Array.from(text.matchAll(new RegExp(`\\b(${MONTHS.join('|')})\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s*)?\\d{0,4}\\b`, 'gi'))).forEach(m => {
    const v = m[0].trim().replace(/,\s*$/, ''); if (v.length < 4) return
    const yr = v.match(/\b(19|20)\d{2}\b/); if (yr) capturedYears.add(yr[0])
    const monthName = (v.match(new RegExp(`(${MONTHS.join('|')})`, 'i')) ?? ['',''])[1]
    const monthIdx  = MONTHS.findIndex(mo => mo.toLowerCase() === monthName.toLowerCase())
    const dayMatch  = v.match(/(\d{1,2})(?:st|nd|rd|th)?/)
    const yearMatch = v.match(/\b(19|20)\d{2}\b/)
    let dateSequence: string[]
    if (dayMatch) {
      const d = parseInt(dayMatch[1])
      dateSequence = Array.from({ length: Math.min(d, 9) }, (_, k) => `${Math.max(1, d-8+k)} ${monthName}`)
    } else if (yearMatch) {
      const y = parseInt(yearMatch[0])
      dateSequence = Array.from({ length: Math.min(monthIdx+1, 5) }, (_, k) => `${MONTHS[Math.max(0,monthIdx-4+k)]} ${y}`)
    } else { dateSequence = [v] }
    push(v, 'date', { dateSequence })
  })
  Array.from(text.matchAll(/\b(19|20)\d{2}\b/g)).forEach(m => {
    if (capturedYears.has(m[0])) return
    push(m[0], 'year', { numericTarget: parseInt(m[0]) })
  })
  Array.from(text.matchAll(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s+(?:million|billion|trillion|thousand)\b/gi)).forEach(m => {
    push(m[0].trim(), 'figure', { numericTarget: parseN(m[0]) })
  })
  return items.slice(0, 4)
}

// ── Canvas draw function (runs inside headless browser) ──────────
const CANVAS_SCRIPT = `
function _fmtBig(n){
  if(n>=1e9)return(n/1e9).toFixed(1)+'B'
  if(n>=1e6)return(n/1e6).toFixed(1)+'M'
  if(n>=1e3)return(n/1e3).toFixed(1)+'K'
  return Math.round(n).toLocaleString()
}
function _val(stat,el){
  const p=Math.min(1,Math.max(0,el)/1100), e=1-Math.pow(1-p,3)
  switch(stat.type){
    case'percent':return Math.round(e*(stat.numericTarget||0))+'%'
    case'year':return String(Math.round((stat.numericTarget-10)+e*10))
    case'money':{const pfx=(stat.raw.match(/^[$£€₦₵¥]/)||[''])[0];return pfx+_fmtBig(e*(stat.numericTarget||0))}
    case'figure':return _fmtBig(e*(stat.numericTarget||0))
    case'date':{const s=stat.dateSequence||[stat.raw];return s[Math.min(s.length-1,Math.floor(e*s.length))]}
    default:return stat.raw
  }
}
function _spring(el){
  if(el<=0)return 0; if(el>=500)return 1
  const t=el/500
  if(t<0.6)return(t/0.6)*1.12
  if(t<0.8)return 1.12-((t-0.6)/0.2)*0.17
  return 0.95+((t-0.8)/0.2)*0.05
}
function _hex2rgb(h){return{r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)}}
function _rgba(h,a){const{r,g,b}=_hex2rgb(h);return'rgba('+r+','+g+','+b+','+a+')'}

window.__drawFrame=function(stats,glowColors,labels,t_ms){
  const cv=document.getElementById('c'), ctx=cv.getContext('2d')
  ctx.clearRect(0,0,1920,1080)
  const rp=40, bp=90, gap=16, vs=58, ls=14
  const blocks=[]
  for(let i=0;i<stats.length;i++){
    const s=stats[i], delay=i*380, el=t_ms-delay
    const sc=_spring(el), op=el>0?Math.min(1,el/80):0
    if(op<=0){blocks.push(null);continue}
    const col=glowColors[s.type], lbl=labels[s.type], val=_val(s,el)
    ctx.font='900 '+vs+'px Arial Black,Arial'; const vw=ctx.measureText(val).width
    ctx.font='600 '+ls+'px Arial'; const lw=ctx.measureText(lbl).width
    blocks.push({col,lbl,val,vw,lw,sc,op})
  }
  let bot=1080-bp
  for(let i=blocks.length-1;i>=0;i--){
    const b=blocks[i]; if(!b)continue
    const bh=ls+6+vs, bw=Math.max(b.vw,b.lw)+4
    const bx=1920-rp-bw, bt=bot-bh
    ctx.save()
    ctx.globalAlpha=b.op
    const ox=1920-rp, oy=bot
    ctx.translate(ox,oy); ctx.scale(b.sc,b.sc); ctx.translate(-ox,-oy)
    // label
    ctx.font='600 '+ls+'px Arial'; ctx.shadowBlur=0
    ctx.fillStyle=_rgba(b.col,0.65); ctx.textBaseline='top'
    ctx.fillText(b.lbl,bx,bt)
    // value glow layers
    ctx.font='900 '+vs+'px Arial Black,Arial'; ctx.textBaseline='top'
    const glows=[[70,0.12],[40,0.28],[18,0.55]]
    for(const[blur,alpha]of glows){
      ctx.shadowColor=_rgba(b.col,alpha); ctx.shadowBlur=blur
      ctx.fillStyle=_rgba(b.col,alpha); ctx.fillText(b.val,bx,bt+ls+6)
    }
    ctx.shadowBlur=0; ctx.fillStyle=b.col; ctx.fillText(b.val,bx,bt+ls+6)
    ctx.restore()
    bot=bt-gap
  }
}
`

const PAGE_HTML = `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0}html,body{width:1920px;height:1080px;background:transparent;overflow:hidden}
</style></head><body>
<canvas id="c" width="1920" height="1080"></canvas>
<script>${CANVAS_SCRIPT}</script>
</body></html>`

// Overlay crop region (bottom-right where stats appear)
const CROP = { x: 1300, y: 430, w: 620, h: 590 }

export async function generateStatFrames(
  stats: StatData[],
  durationSecs: number,
  outDir: string,
  fps = 25
): Promise<boolean> {
  if (!stats.length) return false
  fs.mkdirSync(outDir, { recursive: true })

  const BASE_ARGS = [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--disable-software-rasterizer', '--disable-web-security',
    '--font-render-hinting=none', '--single-process',
  ]

  let browser: any
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT

  if (isProduction) {
    let chromium: any, puppeteerCore: any
    try {
      chromium      = (await import('@sparticuz/chromium')).default
      puppeteerCore = (await import('puppeteer-core')).default
    } catch (e) {
      console.warn('sparticuz/chromium not available:', e)
      return false
    }
    const executablePath = await chromium.executablePath()
    browser = await puppeteerCore.launch({
      args: [...chromium.args, ...BASE_ARGS],
      executablePath,
      headless: chromium.headless,
      defaultViewport: { width: 1920, height: 1080 },
    })
  } else {
    let puppeteer: any
    try { puppeteer = (await import('puppeteer')).default ?? (await import('puppeteer')) } catch {
      console.warn('puppeteer not installed — skipping stat overlay')
      return false
    }
    try {
      browser = await puppeteer.launch({ headless: 'new', args: BASE_ARGS })
    } catch {
      browser = await puppeteer.launch({ headless: true, args: BASE_ARGS })
    }
  }

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
    await page.setContent(PAGE_HTML, { waitUntil: 'domcontentloaded' })

    const totalFrames = Math.ceil(durationSecs * fps)

    for (let f = 0; f < totalFrames; f++) {
      const t_ms = (f / fps) * 1000
      await page.evaluate(
        (stats: any, colors: any, labels: any, t: number) => (window as any).__drawFrame(stats, colors, labels, t),
        stats, GLOW_COLORS, LABELS, t_ms
      )
      const framePath = path.join(outDir, `frame_${String(f).padStart(5, '0')}.png`)
      await page.screenshot({
        path: framePath as `${string}.png`,
        omitBackground: true,
        clip: { x: CROP.x, y: CROP.y, width: CROP.w, height: CROP.h },
        type: 'png',
      })
    }

    await page.close()
    return true
  } finally {
    await browser.close()
  }
}

// ── Coin sound track builder ─────────────────────────────────────
// Returns path to the coin MP3 if it exists in public/, otherwise
// falls back to a synthesized WAV so rendering never breaks.
export function getCoinSoundPath(): string {
  const mp3 = path.join(process.cwd(), 'public', 'coin.mp3')
  if (fs.existsSync(mp3)) return mp3
  return '' // caller will fall back to synthesized
}

// ── Synthesized coin WAV fallback (pure Node.js, no deps) ────────
// Generates a single WAV file with all coin sounds placed at the
// correct timestamps so FFmpeg can mix it into the final video audio.
export function generateCoinTrack(timestamps: number[], totalDuration: number): Buffer {
  const SR = 44100
  const totalSamples = Math.ceil((totalDuration + 1) * SR) // +1s safety pad
  const mix = new Float32Array(totalSamples)

  // Three overlapping tones that form the coin clink
  const tones = [
    { freq: 1400, delay: 0 },
    { freq: 1900, delay: 0.07 },
    { freq: 1600, delay: 0.13 },
  ]
  const VOL = 0.18
  const DECAY = 22  // higher = faster fade

  for (const ts of timestamps) {
    for (const tone of tones) {
      const start = Math.floor((ts + tone.delay) * SR)
      const len   = Math.floor(0.22 * SR)
      for (let i = 0; i < len; i++) {
        const idx = start + i
        if (idx >= totalSamples) break
        const t = i / SR
        mix[idx] += Math.sin(2 * Math.PI * tone.freq * t) * Math.exp(-t * DECAY) * VOL
      }
    }
  }

  // Clamp and convert to 16-bit PCM
  const pcm = Buffer.alloc(totalSamples * 2)
  for (let i = 0; i < totalSamples; i++) {
    const v = Math.max(-1, Math.min(1, mix[i]))
    pcm.writeInt16LE(Math.round(v * 32767), i * 2)
  }

  // WAV header (mono, 44100 Hz, 16-bit PCM)
  const hdr = Buffer.alloc(44)
  hdr.write('RIFF', 0);  hdr.writeUInt32LE(36 + pcm.length, 4)
  hdr.write('WAVE', 8);  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16)
  hdr.writeUInt16LE(1, 20)                      // PCM
  hdr.writeUInt16LE(1, 22)                      // mono
  hdr.writeUInt32LE(SR, 24)
  hdr.writeUInt32LE(SR * 2, 28)                 // byte rate
  hdr.writeUInt16LE(2, 32)                      // block align
  hdr.writeUInt16LE(16, 34)                     // bits per sample
  hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([hdr, pcm])
}

export function cleanFrames(dir: string) {
  try {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)))
      fs.rmdirSync(dir)
    }
  } catch {}
}

export { CROP }
