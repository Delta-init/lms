'use client'

import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { motion } from 'framer-motion'
import { PageHeader } from '@/components/ui/PageHeader'
import { UserTable } from '@/components/users/UserTable'
import { AddStudentModal } from '@/components/users/AddStudentModal'
import { useCurrentUser } from '@/lib/api/user'
import { useRouter, useSearchParams } from 'next/navigation'

export default function StudentsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(() => searchParams.get('add') === '1')
  const { data: me } = useCurrentUser()
  const canAddStudent = ['super_admin', 'admin', 'instructor'].includes(me?.role ?? '')

  const handleClose = () => {
    setModalOpen(false)
    router.replace('/students', { scroll: false })
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Students"
          subtitle="Everyone enrolled on the platform"
          badge={{ label: 'Users', color: '#2F6BFF' }}
        />
        {canAddStudent && (
          <motion.button
            onClick={() => setModalOpen(true)}
            whileHover={{ y: -1, boxShadow: '0 6px 20px rgba(47,107,255,0.28)' }}
            whileTap={{ scale: 0.97 }}
            className="mt-1 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #2F6BFF, #5B8FFF)' }}
          >
            <UserPlus size={15} />
            Add Student
          </motion.button>
        )}
      </div>

      <UserTable role="student" label="Students" />

      {canAddStudent && <AddStudentModal open={modalOpen} onClose={handleClose} />}
    </div>
  )
}
