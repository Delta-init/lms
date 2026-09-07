/* ─────────────────────────────────────────────────────
   Title Case for user-entered names.

   Course and class titles are typed by whoever created them, so the catalogue
   carries whatever they pressed — "market break out", "MARKET BREAK OUT",
   "Market break out" — and a grid of cards shows all three spellings at once.
   Normalising at render keeps the UI even without rewriting anyone's data.

   Deliberately NOT a blunt capitalise-every-word:

     * small words stay lowercase inside the phrase (of, the, and …) but are
       capitalised when they lead, which is what "title case" actually means;
     * ALL-CAPS input is treated as shouting and folded down, while a word
       with capitals *inside* it (JavaScript, iOS, CFA) is left exactly as
       typed — those are spellings, not accidents;
     * hyphens and slashes are word boundaries, so "day-trading" and
       "risk/reward" both come out right.
───────────────────────────────────────────────────── */

const MINOR = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on',
  'or', 'per', 'the', 'to', 'up', 'via', 'vs', 'with',
])

/** True when a word carries its own capitalisation we must not touch. */
function isDeliberate(word: string): boolean {
  //  JavaScript, iOS, CFA, MT5 — a capital anywhere but the first letter.
  return /[A-Z]/.test(word.slice(1))
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export function titleCase(input: string | null | undefined): string {
  if (!input) return ''
  const text = input.trim()
  if (!text) return ''

  //  Split on spaces but keep hyphens/slashes as inner boundaries.
  return text
    .split(/\s+/)
    .map((word, wordIndex, all) => {
      if (isDeliberate(word)) return word

      const lower = word.toLowerCase()
      const isEdge = wordIndex === 0 || wordIndex === all.length - 1

      return lower
        .split(/([-/])/)
        .map((part, partIndex) => {
          if (part === '-' || part === '/') return part
          //  Minor words stay down, except at either end of the title.
          if (!isEdge && partIndex === 0 && MINOR.has(part)) return part
          return capitalise(part)
        })
        .join('')
    })
    .join(' ')
}
