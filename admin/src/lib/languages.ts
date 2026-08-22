/* ─────────────────────────────────────────────────────
   languages — the single list of languages the academy teaches in.

   This is the set the Live Classes filter has always used. Course creation
   used to carry its own, unrelated list (Spanish / German / Japanese …),
   which meant a course could be tagged with a language no class is ever
   delivered in, and the two filters never lined up. Both now read from here,
   so adding a language is a one-line change in one file.
───────────────────────────────────────────────────── */
export interface LanguageOption {
  value: string
  label: string
  flag:  string
}

export const CLASS_LANGUAGES: LanguageOption[] = [
  { value: 'English',   label: 'English',   flag: '🇬🇧' },
  { value: 'Malayalam', label: 'Malayalam', flag: '🇮🇳' },
  { value: 'Hindi',     label: 'Hindi',     flag: '🇮🇳' },
  { value: 'Tamil',     label: 'Tamil',     flag: '🇮🇳' },
]

/* Options for a plain <Select>. `current` keeps a legacy value (a course
   saved as "Spanish" before this list shrank) selectable, so opening and
   saving an old course cannot silently relabel its language. */
export function courseLanguageOptions(current?: string): { value: string; label: string }[] {
  const base = CLASS_LANGUAGES.map(l => ({ value: l.value, label: l.label }))
  if (current && !base.some(o => o.value === current)) {
    base.push({ value: current, label: `${current} (legacy)` })
  }
  return base
}
