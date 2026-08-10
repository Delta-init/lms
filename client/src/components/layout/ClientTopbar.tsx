'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Search, Bell, X, MessageSquare, BookOpen,
  GraduationCap, Heart, Sparkles, Trophy,
  Settings, Clock, Star, Users, Video, Flame, Menu, ShoppingCart, Map, CalendarDays, LifeBuoy,
  ClipboardList,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import { useUIStore } from '@/store/ui.store'
import { useCurrentUser } from '@/lib/api/user'
import { useCartStore } from '@/store/cart.store'
import type { Course, PaginationMeta } from '@/types/index'
import {
  useNotifications, useUnreadCount, useMarkRead, useMarkAllRead,
  type Notification,
} from '@/lib/api/notifications'
import { AIChatPanel } from '@/components/layout/AIChatPanel'
import { useIsMobile } from '@/hooks/useIsMobile'

/* Nav tabs shown when sidebar layout is active (minimal — sidebar handles main nav) */
const SIDEBAR_TABS = [
  { label: 'My Learning', href: '/my-learning',    icon: GraduationCap },
  { label: 'Schedule',    href: '/class-bookings', icon: CalendarDays },
  { label: 'Assignments', href: '/assignments',     icon: ClipboardList },
  { label: 'Catalog',     href: '/courses',         icon: BookOpen },
  { label: 'Learning Paths', href: '/learning-paths', icon: Map },
  { label: 'Favorites',   href: '/favorites',       icon: Heart, badge: 1 },
  { label: 'Support',     href: '/support',         icon: LifeBuoy },
]

/* Nav tabs shown when topbar-only layout is active (full navigation) */
const TOPBAR_TABS = [
  { label: 'My Learning',    href: '/my-learning',    icon: GraduationCap },
  { label: 'Class Schedule', href: '/class-bookings', icon: CalendarDays },
  { label: 'Assignments',    href: '/assignments',     icon: ClipboardList },
  { label: 'Catalog',        href: '/courses',         icon: BookOpen },
  { label: 'Learning Paths', href: '/learning-paths',  icon: Map },
  { label: 'Achievements',   href: '/achievements',    icon: Trophy },
  { label: 'Streaks',        href: '/streaks',         icon: Flame },
  { label: 'Favorites',      href: '/favorites',       icon: Heart, badge: 1 },
  { label: 'Settings',       href: '/settings',        icon: Settings },
  { label: 'Help & Support', href: '/support',         icon: LifeBuoy },
]

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/* ── Live-search hook: debounce 280ms, min 2 chars ── */
function useTypeahead(q: string) {
  return useQuery({
    queryKey: ['typeahead', q],
    queryFn: async () => {
      const res = await api.get<{ success: true; data: Course[]; meta: PaginationMeta }>(
        '/courses',
        { params: { search: q, search_mode: 'prefix', per_page: 5 } },
      )
      return res.data.data
    },
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  })
}

/* ── Syncs the search input with ?q= on the /search page ──────
   Must live in its own component so useSearchParams() is
   isolated inside a Suspense boundary (Next.js 15 requirement).
────────────────────────────────────────────────────────────── */
function SearchSync({
  isSearchPage,
  setQuery,
  setDebouncedQ,
}: {
  isSearchPage: boolean
  setQuery: (q: string) => void
  setDebouncedQ: (q: string) => void
}) {
  const searchParams = useSearchParams()
  useEffect(() => {
    if (isSearchPage) {
      const q = searchParams.get('q') ?? ''
      setQuery(q)
      setDebouncedQ(q)
    }
  }, [isSearchPage, searchParams, setQuery, setDebouncedQ])
  return null
}

function fmtMins(m: number) {
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); const rem = m % 60
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`
}

export function ClientTopbar() {
  const { setMobileNav } = useUIStore()
  const pathname = usePathname()
  const router = useRouter()
  const isSearchPage = pathname === '/search'

  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const [aiChatOpen, setAiChatOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  /* Debounce the query for typeahead (skip on search page — results shown inline) */
  useEffect(() => {
    if (isSearchPage) return
    const t = setTimeout(() => setDebouncedQ(query), 280)
    return () => clearTimeout(t)
  }, [query, isSearchPage])

  /* Close dropdown on outside click */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const { data: suggestions, isFetching } = useTypeahead(debouncedQ)
  const showDropdown = focused && !isSearchPage && debouncedQ.trim().length >= 2
  const { data: user } = useCurrentUser()
  const { data: notifData } = useNotifications({ per_page: 8 })
  const { data: unreadCount } = useUnreadCount()
  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()
  const notifications: Notification[] = notifData?.items ?? []
  const unread = unreadCount ?? notifData?.unreadCount ?? 0

  const displayName = user?.name ?? 'Account'
  const displayRole = user?.headline ?? (user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Student')
  const avatarInitial = (user?.name?.trim()?.[0] ?? '?').toUpperCase()
  const hasAvatarImage = !!user?.avatarUrl

  const isMobile = useIsMobile()
  /* Desktop sidebar removed — topbar always spans full width */
  const left = 0
  /* Always show full nav tabs in the topbar */
  const tabs = TOPBAR_TABS
  const cartCount = useCartStore(s => s.items.length)

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <>
      <motion.header
        /* ── Slides in from top on mount ── */
        initial={{ y: -100, opacity: 0 }}
        animate={{ left, y: 0, opacity: 1 }}
        transition={{ y: { type: 'spring', stiffness: 280, damping: 28, mass: 0.8 }, left: { type: 'spring', stiffness: 300, damping: 30 } }}
        className="fixed top-0 right-0 z-30 bg-white"
        style={{ borderBottom: '1px solid #E5E7EB' }}>

        {/* ── Row 1: Logo (topbar mode) + search + actions ── */}
        <div className="flex h-[60px] items-center gap-3 px-4 sm:px-6" style={{ borderBottom: '1px solid #F3F4F6' }}>

          {/* Hamburger — always shown on mobile for the mobile drawer */}
          <button
            onClick={() => setMobileNav(true)}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-blue-50 lg:hidden"
            style={{ color: '#0057b8' }}
            aria-label="Open menu">
            <Menu size={18} />
          </button>

          {/* Logo — always visible (no desktop sidebar) */}
          <div className="flex items-center mr-2 sm:mr-4 flex-shrink-0">
            <img
              src="/logo-dark.png"
              alt="Delta International"
              className="h-8 sm:h-11 w-auto object-contain"
            />
          </div>

          {/* Search — live typeahead, syncs with /search page */}
          <div className="relative min-w-0 flex-1 sm:max-w-[380px]">
            <form
              onSubmit={e => {
                e.preventDefault()
                setFocused(false)
                const q = query.trim()
                router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
              }}>
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10"
                style={{ color: '#0057b8', opacity: focused ? 1 : 0.55 }} />
              <input
                ref={inputRef}
                value={query}
                onChange={e => {
                  setQuery(e.target.value)
                  /* On /search page update URL in place so results refresh */
                  if (isSearchPage) {
                    const v = e.target.value.trim()
                    router.replace(v ? `/search?q=${encodeURIComponent(v)}` : '/search')
                  }
                }}
                onFocus={() => setFocused(true)}
                onKeyDown={e => { if (e.key === 'Escape') { setFocused(false); inputRef.current?.blur() } }}
                placeholder="Search courses…"
                className="w-full rounded-xl py-2 pl-9 pr-10 text-sm outline-none transition-all"
                style={{
                  background: focused ? '#FFF7ED' : '#F3F4F6',
                  border: focused ? '1.5px solid #0057b8' : '1.5px solid transparent',
                  boxShadow: focused ? '0 0 0 3px rgba(0,87,184,0.10)' : 'none',
                  color: '#111827',
                }} />
              {query && (
                <button type="button"
                  onClick={() => {
                    setQuery(''); setDebouncedQ('')
                    if (isSearchPage) router.replace('/search')
                    inputRef.current?.focus()
                  }}
                  className="absolute right-9 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-md hover:bg-gray-200 transition-colors"
                  style={{ color: '#9CA3AF' }}>
                  <X size={11} />
                </button>
              )}
              {/* <motion.button
              type="submit"
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-white"
              style={{ background: '#0057b8', boxShadow: '0 2px 8px rgba(0,87,184,0.30)' }}>
              <Search size={12} />
            </motion.button> */}
            </form>

            {/* ── Typeahead dropdown (only on non-search pages) ── */}
            <AnimatePresence>
              {showDropdown && (
                <motion.div
                  ref={dropdownRef}
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  className="absolute left-0 right-0 top-full mt-1.5 rounded-2xl overflow-hidden z-50 bg-white"
                  style={{ border: '1px solid #E5E7EB', boxShadow: '0 8px 32px rgba(0,0,0,0.10)' }}>

                  {isFetching && !suggestions?.length ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-xs" style={{ color: '#9CA3AF' }}>
                      <Search size={12} className="animate-pulse" />
                      Searching…
                    </div>
                  ) : suggestions && suggestions.length === 0 ? (
                    <div className="px-4 py-3 text-xs" style={{ color: '#9CA3AF' }}>
                      No courses found for &ldquo;{debouncedQ}&rdquo;
                    </div>
                  ) : (
                    <>
                      {suggestions?.map(course => (
                        <Link
                          key={course.id}
                          href={`/courses/${course.slug}`}
                          onClick={() => { setFocused(false); setQuery(course.title) }}>
                          <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-blue-50 cursor-pointer"
                            style={{ borderBottom: '1px solid #F9FAFB' }}>
                            {/* Thumbnail */}
                            <div className="h-10 w-14 flex-shrink-0 overflow-hidden rounded-lg"
                              style={{ background: '#F3F4F6' }}>
                              {course.thumbnailUrl
                                ? <img src={course.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                                : <div className="flex h-full w-full items-center justify-center">
                                  <BookOpen size={14} style={{ color: '#D1D5DB' }} />
                                </div>}
                            </div>
                            {/* Info */}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold leading-snug" style={{ color: '#111827' }}>
                                {course.title}
                              </p>
                              <div className="mt-0.5 flex items-center gap-2 text-[10px]" style={{ color: '#9CA3AF' }}>
                                {course.ratingAvg > 0 && (
                                  <span className="flex items-center gap-0.5" style={{ color: '#F59E0B' }}>
                                    <Star size={9} fill="#F59E0B" />{course.ratingAvg.toFixed(1)}
                                  </span>
                                )}
                                <span className="flex items-center gap-0.5">
                                  <Users size={9} />{course.enrolledCount.toLocaleString()}
                                </span>
                                {course.durationMins > 0 && (
                                  <span className="flex items-center gap-0.5">
                                    <Clock size={9} />{fmtMins(course.durationMins)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </Link>
                      ))}
                      {/* View all results */}
                      <Link
                        href={`/search?q=${encodeURIComponent(debouncedQ)}`}
                        onClick={() => setFocused(false)}
                        className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors hover:bg-blue-50"
                        style={{ color: '#0057b8', borderTop: '1px solid #F3F4F6' }}>
                        <Search size={11} />
                        View all results for &ldquo;{debouncedQ}&rdquo;
                      </Link>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Ask AI — orange primary */}
            <motion.button
              onClick={() => setAiChatOpen(v => !v)}
              whileHover={{ scale: 1.02, boxShadow: '0 6px 20px rgba(0,87,184,0.35)' }} whileTap={{ scale: 0.97 }}
              className="hidden sm:flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white"
              style={{ background: '#0057b8', boxShadow: '0 3px 12px rgba(0,87,184,0.22)' }}>
              <Sparkles size={12} />Ask AI
            </motion.button>

            {/* Help & Support */}
            <Link href="/support">
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-blue-50"
                style={{ color: '#0057b8' }}>
                <MessageSquare size={16} />
              </motion.div>
            </Link>

            {/* Cart */}
            <Link href="/cart">
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                className="relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-blue-50"
                style={{ color: '#0057b8' }}>
                <ShoppingCart size={16} />
                <AnimatePresence>
                  {cartCount > 0 && (
                    <motion.span
                      key="cart-badge"
                      initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                      transition={{ type: 'spring', stiffness: 400 }}
                      className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                      style={{ background: '#0057b8' }}>
                      {cartCount}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
            </Link>

            {/* Notifications */}
            <div className="relative">
              <motion.button onClick={() => setNotifOpen(v => !v)}
                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                className="relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-blue-50"
                style={{ color: '#0057b8' }}>
                <Bell size={16} />
                {unread > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400 }}
                    className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                    style={{ background: '#EF4444' }}>
                    {unread}
                  </motion.span>
                )}
              </motion.button>

              <AnimatePresence>
                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.96 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                      className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-72 rounded-2xl overflow-hidden z-50 bg-white"
                      style={{ border: '1px solid #E5E7EB', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
                      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <span className="text-sm font-semibold" style={{ color: '#111827' }}>Notifications</span>
                        {unread > 0 && (
                          <button
                            onClick={() => markAllRead.mutate()}
                            disabled={markAllRead.isPending}
                            className="text-[11px] font-semibold transition-opacity hover:opacity-70 disabled:opacity-50"
                            style={{ color: '#0057b8' }}>
                            Mark all read
                          </button>
                        )}
                      </div>
                      {notifications.length === 0 && (
                        <p className="px-4 py-8 text-center text-xs" style={{ color: '#9CA3AF' }}>
                          You&apos;re all caught up.
                        </p>
                      )}
                      {notifications.map((n, i) => {
                        const isUnread = !n.readAt
                        const inner = (
                          <div className="flex gap-3 px-4 py-3 transition-colors hover:bg-blue-50 cursor-pointer"
                            style={{ borderBottom: i < notifications.length - 1 ? '1px solid #F3F4F6' : 'none' }}>
                            <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ background: isUnread ? '#0057b8' : '#E5E7EB' }} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs leading-relaxed font-semibold" style={{ color: isUnread ? '#111827' : '#6B7280' }}>{n.title}</p>
                              {n.body && (
                                <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: '#9CA3AF' }}>{n.body}</p>
                              )}
                              <p className="mt-0.5 text-[10px]" style={{ color: '#9CA3AF' }}>{relTime(n.createdAt)}</p>
                            </div>
                          </div>
                        )
                        const onClick = () => {
                          if (isUnread) markRead.mutate(n.id)
                          setNotifOpen(false)
                        }
                        return n.link
                          ? <motion.div key={n.id}
                            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.04 }}>
                            <Link href={n.link} onClick={onClick}>{inner}</Link>
                          </motion.div>
                          : <motion.div key={n.id}
                            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.04 }}
                            onClick={onClick}>
                            {inner}
                          </motion.div>
                      })}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* Profile */}
            <Link href="/settings">
              <div className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1 transition-colors hover:bg-blue-50">
                <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white ring-2 ring-blue-100"
                  style={{ background: '#0057b8' }}>
                  {hasAvatarImage
                    ? <img src={user!.avatarUrl} alt="" className="h-full w-full object-cover" />
                    : avatarInitial}
                </div>
                <div className="hidden md:block max-w-[160px]">
                  <p className="truncate text-xs font-semibold leading-tight" style={{ color: '#111827' }}>{displayName}</p>
                  <p className="truncate text-[10px]" style={{ color: '#9CA3AF' }}>{displayRole}</p>
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* ── Sync search input with /search?q= (Suspense-isolated) ── */}
        <Suspense fallback={null}>
          <SearchSync isSearchPage={isSearchPage} setQuery={setQuery} setDebouncedQ={setDebouncedQ} />
        </Suspense>

        {/* ── Row 2: Nav tabs — scrollable on mobile ── */}
        <div className="flex h-[44px] sm:h-[40px] items-end overflow-x-auto px-4 sm:px-6 scrollbar-none">
          {tabs.map((tab, i) => {
            const active = isActive(tab.href)
            return (
              <Link key={tab.href} href={tab.href} className="shrink-0">
                <motion.div
                  initial={{ opacity: 0, y: -16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.05 + i * 0.04 }}
                  className="relative flex h-[40px] items-center gap-1.5 px-4 cursor-pointer select-none">
                  <span className="whitespace-nowrap text-sm font-medium transition-colors"
                    style={{ color: active ? '#111827' : '#9CA3AF', fontWeight: active ? 600 : 400 }}>
                    {tab.label}
                  </span>
                  {tab.badge && (
                    <span aria-label={`${tab.badge} items`}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ background: '#0057b8' }}>
                      <span aria-hidden="true">{tab.badge}</span>
                    </span>
                  )}
                  {active && (
                    <motion.div layoutId="tab-underline"
                      className="absolute bottom-0 left-0 right-0 h-[2.5px] rounded-full"
                      style={{ background: '#0057b8' }}
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
                  )}
                </motion.div>
              </Link>
            )
          })}
        </div>
      </motion.header>

      {/* ── AI Chat slide-out ── */}
      <AIChatPanel open={aiChatOpen} onClose={() => setAiChatOpen(false)} />
    </>
  )
}
