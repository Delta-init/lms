'use client'

import { motion } from 'framer-motion'
import { Heart } from 'lucide-react'
import { useIsFavorited, useToggleFavorite } from '@/lib/api/favorites'
import { MotionButton } from '@/components/ui/button'
import Spinner from '@/components/ui/Spinner'

interface Props {
  courseId: string
  variant?: 'pill' | 'icon'
}

export function FavoriteButton({ courseId, variant = 'pill' }: Props) {
  const { data: favorited } = useIsFavorited(courseId)
  const toggle = useToggleFavorite(courseId)
  const isFav = !!favorited

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggle.mutate(isFav)
  }

  if (variant === 'icon') {
    return (
      <MotionButton
        onClick={onClick}
        disabled={toggle.isPending}
        whileTap={{ scale: 0.9 }}
        whileHover={{ scale: 1.05 }}
        aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-full transition-all"
        style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', boxShadow: '0 4px 12px rgba(13,15,26,0.10)' }}>
        {toggle.isPending
          ? <Spinner size={14} variant="gray" />
          : <Heart size={14} fill={isFav ? '#EF4444' : 'none'} style={{ color: isFav ? '#EF4444' : 'var(--color-text-muted)' }} />}
      </MotionButton>
    )
  }

  return (
    <MotionButton
      onClick={onClick}
      disabled={toggle.isPending}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      variant="ghost"
      size="sm"
      className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all"
      style={isFav
        ? { background: 'rgba(239,68,68,0.10)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.22)' }
        : { background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
      {toggle.isPending
        ? <Spinner size={12} />
        : <Heart size={12} fill={isFav ? '#EF4444' : 'none'} />}
      {isFav ? 'Saved' : 'Save'}
    </MotionButton>
  )
}
