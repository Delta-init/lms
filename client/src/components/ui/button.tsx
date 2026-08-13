'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 select-none whitespace-nowrap',
  {
    variants: {
      variant: {
        default:
          'bg-[#0057b8] text-white shadow-[0_4px_20px_rgba(0,87,184,0.25)] hover:bg-[#004fa6] hover:shadow-[0_8px_28px_rgba(0,87,184,0.35)] hover:-translate-y-0.5 active:translate-y-0',
        secondary:
          'bg-[#2F6BFF] text-white shadow-[0_4px_20px_rgba(47,107,255,0.24)] hover:bg-[#1A53E0] hover:shadow-[0_8px_28px_rgba(47,107,255,0.34)] hover:-translate-y-0.5 active:translate-y-0',
        outline: 'border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-page)] hover:border-[#CDD0DA] active:bg-[#EDEEF2]',
        ghost:
          'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] active:bg-[#EDEEF2]',
        destructive:
          'bg-[#EF4444] text-white hover:bg-[#DC2626] shadow-[0_4px_16px_rgba(239,68,68,0.25)] hover:-translate-y-0.5 active:translate-y-0',
        link:
          'text-[#0057b8] underline-offset-4 hover:underline p-0 h-auto shadow-none',
      },
      size: {
        default: 'h-10 px-5 py-2.5',
        sm:      'h-8 px-3 py-1.5 text-xs rounded-lg',
        lg:      'h-12 px-6 py-3 text-base',
        xl:      'h-14 px-8 py-4 text-base rounded-2xl',
        icon:    'h-9 w-9 rounded-xl',
        'icon-sm': 'h-7 w-7 rounded-lg text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

/** Drop-in for `motion.button` — accepts all Framer Motion props plus Button variants. */
const MotionButton = motion(Button)

export { Button, MotionButton, buttonVariants }
