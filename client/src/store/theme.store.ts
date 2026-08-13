'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/* ─────────────────────────────────────────────────────
   Theme

   Three states, not two. "system" is the default because a user who has
   already told their OS they prefer dark should not have to tell us again —
   and because a hardcoded default is a choice made on their behalf that they
   then have to undo. The toggle cycles light → dark → system.

   The applied value lands on <html data-theme>, which is what globals.css
   keys off. Nothing re-renders on a theme change: the variables resolve in
   CSS, so even inline style={{ color: 'var(--color-text-primary)' }} follows
   along without React being involved.
───────────────────────────────────────────────────── */

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme   = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'lms-theme'

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
}

/** Write the resolved theme to the document. Safe to call repeatedly. */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', resolveTheme(pref))
}

interface ThemeState {
  preference: ThemePreference
  setTheme:   (p: ThemePreference) => void
  /** light → dark → system → light. */
  cycleTheme: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      preference: 'system',

      setTheme: (preference) => {
        applyTheme(preference)
        set({ preference })
      },

      cycleTheme: () => {
        const order: ThemePreference[] = ['light', 'dark', 'system']
        const next = order[(order.indexOf(get().preference) + 1) % order.length]!
        applyTheme(next)
        set({ preference: next })
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      /* Rehydration happens after the first paint, and the boot script in
         layout.tsx has already applied the same value by then — but a stored
         "system" preference still has to be re-resolved here in case the OS
         setting changed while the tab was closed. */
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.preference)
      },
    },
  ),
)
