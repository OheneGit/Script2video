# Script2Video

AI-powered stock video generator. Paste a script → get a rendered MP4.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styles | Tailwind CSS |
| Video search | Pexels API, Pixabay API, YouTube Data API v3 |
| AI keywords | Claude API (Haiku) — optional, falls back to local TF-IDF |
| Render engine | Shotstack cloud render API |

---

## Quick start

### 1. Install dependencies

```bash
cd script2video
npm install
```

### 2. Configure API keys

Copy `.env.local` and fill in your keys:

```env
# Already filled in for you:
PEXELS_API_KEY=BNs7tvOUfT1tK9fHT84vLXdNtFgMJoUEQhj4ItQ1ru5ifiKZP7TvPTvD
PIXABAY_API_KEY=34719021-8f6986e1dfc561e3e70388ed5
YOUTUBE_API_KEY=AIzaSyCLLhMorm1YtGz9ZfxWgvI31jv4pgDBzGc

# Sign up free at https://shotstack.io to get your sandbox key:
SHOTSTACK_API_KEY=your_shotstack_api_key_here
SHOTSTACK_ENV=stage   # change to "production" when going live

# Optional — enables smarter AI keyword extraction:
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

### 3. Run locally

```bash
npm run dev
# Open http://localhost:3000
```

---

## How it works

```
User pastes script
       │
       ▼
POST /api/generate
  ├─ Parse script into segments (one per line)
  ├─ Extract keywords per segment
  │    ├─ Claude API (semantic, if key set)
  │    └─ Local TF-IDF fallback
  ├─ Search Pexels  ──┐
  ├─ Search Pixabay   ├─ parallel
  └─ Search YouTube ──┘
       │
       ▼
User reviews segments, swaps clips via thumbnail picker
       │
       ▼
POST /api/render
  └─ Build Shotstack timeline JSON
       ├─ Video clips with trim points
       ├─ Caption overlays (optional)
       └─ Transitions (cut / fade / zoom)
       │
       ▼
GET /api/status?id=xxx   (polled every 3s)
       │
       ▼
Render complete → MP4 download URL returned
```

---

## API routes

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/generate` | Search all sources for a script |
| `POST` | `/api/render` | Submit render job to Shotstack |
| `GET` | `/api/status?id=xxx` | Poll render status |

### POST /api/generate — request body

```ts
{
  script: string              // full script text
  sources: {
    pexels: boolean
    pixabay: boolean
    youtube: boolean
  }
  clipDuration: number        // seconds per clip (3–15)
  resultsPerSegment: number   // clips to find per segment (3–10)
}
```

### POST /api/render — request body

```ts
{
  segments: ScriptSegment[]   // with chosenIndex set
  resolution: '1920x1080' | '1280x720' | '3840x2160'
  aspectRatio: '16:9' | '9:16' | '1:1'
  transition: 'cut' | 'fade' | 'zoom'
  addCaptions: boolean
  fps: 25 | 30
}
```

---

## Shotstack setup

1. Sign up at [https://shotstack.io](https://shotstack.io) — free sandbox tier available
2. Copy your **Stage API key** from the dashboard
3. Add it to `.env.local` as `SHOTSTACK_API_KEY`
4. Set `SHOTSTACK_ENV=stage` for testing (watermarked output)
5. Switch to `production` key + env for live deployments

**Sandbox limits:** 10 free renders/month, watermarked, up to 10 min video.
**Paid plans** start at ~$49/month for unwatermarked production renders.

---

## Deployment (Vercel — recommended)

```bash
npm install -g vercel
vercel

# Set environment variables in Vercel dashboard or:
vercel env add PEXELS_API_KEY
vercel env add PIXABAY_API_KEY
vercel env add YOUTUBE_API_KEY
vercel env add SHOTSTACK_API_KEY
vercel env add SHOTSTACK_ENV
```

Or deploy with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

---

## Alternative render engines

If you don't want to use Shotstack, you can swap `app/lib/render.ts` for:

| Option | Notes |
|---|---|
| **Creatomate** | Similar JSON-based render API, free tier available |
| **Remotion** | Render in Node.js using React — self-hosted |
| **FFmpeg** (self-hosted) | Full control, requires a server with FFmpeg installed |
| **AWS MediaConvert** | Enterprise-grade, pay per minute |

---

## Project structure

```
script2video/
├── app/
│   ├── api/
│   │   ├── generate/route.ts   # Video search endpoint
│   │   ├── render/route.ts     # Shotstack render submission
│   │   └── status/route.ts     # Render status polling
│   ├── lib/
│   │   ├── types.ts            # Shared TypeScript types
│   │   ├── keywords.ts         # AI + local keyword extraction
│   │   ├── fetchers.ts         # Pexels / Pixabay / YouTube clients
│   │   └── render.ts           # Shotstack render pipeline
│   ├── page.tsx                # Main UI
│   ├── layout.tsx              # Root layout
│   └── globals.css             # Tailwind + base styles
├── .env.local                  # API keys (never commit this)
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## License

MIT
