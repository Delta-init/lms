'use client'

import { motion } from 'framer-motion'
import { useUIStore } from '@/store/ui.store'
import { ClientSidebar } from '@/components/layout/ClientSidebar'
import { ClientTopbar } from '@/components/layout/ClientTopbar'
import { RightSidebar, RightSidebarToggle } from '@/components/layout/RightSidebar'
import { VerifyEmailBanner } from '@/components/auth/VerifyEmailBanner'
import { EnrollmentStatusBanner } from '@/components/auth/EnrollmentStatusBanner'
import { InstallPrompt } from '@/components/pwa/InstallPrompt'
import { Toaster } from '@/components/ui/Toaster'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { rightPanelOpen } = useUIStore()

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg-page)' }}>
      {/* Mobile drawer only — desktop sidebar removed */}
      <ClientSidebar />

      <ClientTopbar />

      <motion.main
        className="min-h-screen pt-[104px] sm:pt-[100px]">
        {/* Reserve right-panel space on lg+ when open */}
        <div className={`px-4 py-5 sm:px-6 sm:py-7 transition-[padding] duration-300 ease-out ${
          rightPanelOpen ? 'lg:pr-[344px]' : 'lg:pr-6'
        }`}>
          <VerifyEmailBanner />
          <EnrollmentStatusBanner />
          {children}
        </div>
      </motion.main>

      <RightSidebar />
      <RightSidebarToggle />
      <InstallPrompt />
      <Toaster />
    </div>
  )
}
