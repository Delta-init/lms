import FlickerSpinner from './FlickerSpinner'

const VARIANTS = {
  blue:  { on: '#0057b8', off: '#bcd3f2' },
  white: { on: '#ffffff', off: 'rgba(255,255,255,0.25)' },
  muted: { on: 'rgba(255,255,255,0.55)', off: 'rgba(255,255,255,0.1)' },
  gray:  { on: 'var(--color-text-muted)', off: 'var(--color-border)' },
} as const

export default function Spinner({
  size = 14,
  variant = 'blue',
  className,
}: {
  size?: number
  variant?: keyof typeof VARIANTS
  className?: string
}) {
  const { on, off } = VARIANTS[variant]
  const spinner = <FlickerSpinner size={size} on={on} off={off} />
  if (!className) return spinner
  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      {spinner}
    </span>
  )
}
