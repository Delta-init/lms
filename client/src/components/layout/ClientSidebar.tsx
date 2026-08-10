'use client'

import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpen, GraduationCap, Trophy,
  Settings, LogOut, Flame, Map, X, Video, CalendarDays, LifeBuoy,
} from 'lucide-react'
import { useUIStore } from '@/store/ui.store'
import { logout as apiLogout } from '@/lib/api/user'

const navItems = [
  { label: 'My Learning',    href: '/my-learning',    icon: GraduationCap },
  { label: 'Class Schedule', href: '/class-bookings', icon: CalendarDays },
  { label: 'My Classes',     href: '/my-bookings',    icon: Video },
  { label: 'Catalog',        href: '/courses',         icon: BookOpen },
  { label: 'Learning Paths', href: '/learning-paths',  icon: Map },
  { label: 'Achievements',   href: '/achievements',    icon: Trophy },
  { label: 'Streaks',        href: '/streaks',         icon: Flame },
  { label: 'Help & Support', href: '/support',         icon: LifeBuoy },
]
const bottomItems = [{ label: 'Settings', href: '/settings', icon: Settings }]

const itemVariants = {
  hidden: { opacity: 0, x: -14 },
  show:   (i: number) => ({
    opacity: 1, x: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 26, delay: 0.06 + i * 0.04 },
  }),
}

function SidebarContent({ onClose }: { onClose: () => void }) {
  const pathname = usePathname()
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  const handleLogout = async () => {
    await apiLogout()
    localStorage.removeItem('lms-cart')
    window.location.href = '/login'
  }

  return (
    <>
      {/* ── Logo ─────────────────────────────── */}
      <div className="flex h-[60px] flex-shrink-0 items-center gap-3 px-4"
        style={{ borderBottom: '1px solid #E4E7ED' }}>
        <img
          src="/logo-dark.png"
          alt="Delta International"
          className="h-8 w-auto object-contain"
        />
        <button onClick={onClose}
          className="ml-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-blue-50"
          style={{ color: '#0057b8' }}>
          <X size={15} />
        </button>
      </div>

      {/* ── Nav ──────────────────────────────── */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-4">
        <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.15em]"
          style={{ color: '#9CA3AF' }}>Menu</p>

        {navItems.map((item, i) => {
          const active = isActive(item.href)
          const Icon   = item.icon
          return (
            <motion.div key={item.href} custom={i} variants={itemVariants} initial="hidden" animate="show">
              <Link href={item.href} onClick={onClose}>
                <motion.div whileTap={{ scale: 0.97 }}
                  className="relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
                  style={{ background: active ? 'rgba(0,87,184,0.08)' : 'transparent', color: active ? '#0057b8' : '#4B5563' }}>
                  {active && (
                    <motion.div layoutId="mobile-sidebar-active" className="absolute inset-0 rounded-xl"
                      style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.18)' }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
                  )}
                  <Icon size={17} className="relative z-10 flex-shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                  <span className="relative z-10 whitespace-nowrap text-sm font-medium">{item.label}</span>
                </motion.div>
              </Link>
            </motion.div>
          )
        })}
      </nav>

      {/* ── Bottom ────────────────────────────── */}
      <div className="flex-shrink-0 px-2 pb-4" style={{ borderTop: '1px solid #E4E7ED', paddingTop: 12 }}>
        {bottomItems.map((item) => {
          const Icon = item.icon
          return (
            <Link key={item.href} href={item.href} onClick={onClose}>
              <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-blue-50"
                style={{ color: '#9CA3AF' }}>
                <Icon size={17} strokeWidth={1.8} className="flex-shrink-0" />
                <span className="whitespace-nowrap text-sm font-medium">{item.label}</span>
              </div>
            </Link>
          )
        })}

        {/* User row */}
        <div className="mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5"
          style={{ background: '#F4F5F8', border: '1px solid #E4E7ED' }}>
          <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full">
            <div className="flex h-full w-full items-center justify-center text-xs font-bold text-white"
              style={{ background: '#0057b8' }}>A</div>
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white"
              style={{ background: '#0ECC8E' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold" style={{ color: '#0D0F1A' }}>Adit Irwan</p>
            <p className="truncate text-[10px]" style={{ color: '#9CA3AF' }}>student@learnos.com</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex-shrink-0 transition-all hover:text-red-500" style={{ color: '#9CA3AF' }}>
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </>
  )
}

export function ClientSidebar() {
  const { mobileNavOpen, setMobileNav } = useUIStore()

  return (
    <AnimatePresence>
      {mobileNavOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="client-mobile-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileNav(false)}
          />
          {/* Drawer */}
          <motion.aside
            key="client-mobile-drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed left-0 top-0 z-50 flex h-screen w-[min(280px,85vw)] flex-col overflow-hidden bg-white"
            style={{ borderRight: '1px solid #E4E7ED' }}>
            <SidebarContent onClose={() => setMobileNav(false)} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
