/**
 * AI Keyword Extraction — Documentary Style
 * ──────────────────────────────────────────
 * Generates 4-5 visually distinct keyword options per sentence,
 * always mixing: establishing shots + human elements + detail/b-roll.
 * Picks the best 2-3 to search, splitting clip duration across them.
 */

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','to',
  'of','in','on','at','by','for','with','about','into','through','during',
  'before','after','above','below','from','up','down','out','off','over',
  'under','that','this','these','those','we','they','our','their','its','it',
  'he','she','and','or','but','so','yet','nor','as','if','than','when','then',
  'more','most','such','some','any','all','both','each','every','either',
  'neither','just','very','also','not','no','can','my','your','his','her',
  'us','them','which','who','what','how','where','why','there','here','now',
  'start','starts','making','one','two','three','today','literally','specific',
  'very','real','actual','often','never','always','sometimes','might','even',
])

// Human-element keywords to always blend in
const HUMAN_CONTEXTS = [
  'person walking street',
  'people neighborhood',
  'man looking building',
  'woman working inside',
  'family home exterior',
  'worker construction site',
  'person holding document',
  'crowd city street',
  'man driving car',
  'person shocked expression',
  'people talking outside',
  'worker carrying bricks',
  'person opening door',
  'man renovating house',
  'person signing paperwork',
]

function localExtract(text: string): KeywordSet {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))

  const freq: Record<string, number> = {}
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1 })

  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(e => e[0])

  // Build bigrams for better specificity
  const bigrams: string[] = []
  for (let i = 0; i < words.length - 1; i++) {
    if (!STOP_WORDS.has(words[i]) && !STOP_WORDS.has(words[i+1])) {
      bigrams.push(`${words[i]} ${words[i+1]}`)
    }
  }

  const placeKeyword  = bigrams[0] || top.slice(0, 2).join(' ')
  const detailKeyword = top.slice(1, 3).join(' ') + ' close up'
  const humanKeyword  = HUMAN_CONTEXTS[Math.floor(Math.random() * HUMAN_CONTEXTS.length)]

  return {
    options: [placeKeyword, detailKeyword, humanKeyword, top[0] + ' aerial', top.slice(0,2).join(' ') + ' detail'],
    picks: [placeKeyword, humanKeyword, detailKeyword],
  }
}

export interface KeywordSet {
  options: string[]  // all generated keyword options (4-5)
  picks: string[]    // best 2-3 to actually search (mix of place + human + detail)
}

async function claudeExtract(text: string): Promise<KeywordSet | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key.startsWith('your_')) return null

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: `You are a documentary video editor. Given a script sentence, generate stock video search keywords.

RULES:
- Generate exactly 5 keyword phrases (3-5 words each)
- ALWAYS include at least 2 keywords with people/humans (e.g. "person walking street", "man looking at house", "woman holding document")
- Mix: 1-2 establishing/place shots + 2 human-focused + 1 close-up detail
- Think visually — what would a documentary filmmaker cut to?
- Keywords must work as stock video search terms on Pexels/Pixabay
- Be specific and cinematic, not generic

OUTPUT FORMAT (JSON only, no explanation):
{"options":["keyword 1","keyword 2","keyword 3","keyword 4","keyword 5"],"picks":["keyword 1","keyword 3","keyword 2"]}

picks = the best 2-3 in order of use (establishing → human → detail)`,
        messages: [{ role: 'user', content: text }],
      }),
    })

    if (!res.ok) return null
    const data = await res.json()
    const raw = data.content?.[0]?.text?.trim() || ''

    // Parse JSON response
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])

    if (!parsed.options || !parsed.picks) return null

    // Always ensure human element is in picks
    const hasHuman = parsed.picks.some((p: string) =>
      /person|people|man|woman|worker|family|crowd|someone|user/.test(p.toLowerCase())
    )
    if (!hasHuman) {
      // inject a human-focused option
      const humanOpt = parsed.options.find((o: string) =>
        /person|people|man|woman|worker|family|crowd/.test(o.toLowerCase())
      )
      if (humanOpt && !parsed.picks.includes(humanOpt)) {
        parsed.picks[parsed.picks.length - 1] = humanOpt
      }
    }

    return parsed as KeywordSet

  } catch (err) {
    console.error('Claude keyword error:', err)
    return null
  }
}

export async function extractKeywords(text: string): Promise<KeywordSet> {
  const ai = await claudeExtract(text)
  return ai || localExtract(text)
}
