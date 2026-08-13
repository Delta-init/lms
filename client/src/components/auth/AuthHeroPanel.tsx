'use client'

import { motion } from 'framer-motion'
import { Shield, MapPin, Lock } from 'lucide-react'

const stats = [
  { value: '7K+', label: 'Members' },
  { value: '8+', label: 'Years' },
  { value: '20+', label: 'Trainers' },
]

const infoItems = [
  { Icon: Shield, label: 'KHDA Approved' },
  { Icon: MapPin, label: 'Dubai, UAE' },
  { Icon: Lock, label: 'Secure & Private' },
]

export function AuthHeroPanel() {
  return (
    <div
      className="relative h-full w-full overflow-hidden select-none flex flex-col items-center justify-center"
      style={{ background: 'var(--color-primary)' }}
    >
      {/* CSS animations */}
      <style>{`
        @keyframes deltaGridScroll {
          from { background-position: 0 0; }
          to   { background-position: 40px 0; }
        }
        .delta-grid-anim {
          background-image: none;
        }
        @keyframes deltaFloat {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-9px); }
        }
        .delta-logo-float { animation: deltaFloat 4s ease-in-out infinite; }
        @keyframes deltaPulseDot {
          0%   { box-shadow: 0 0 0 0   rgba(125,211,252,0.7); }
          70%  { box-shadow: 0 0 0 7px rgba(125,211,252,0); }
          100% { box-shadow: 0 0 0 0   rgba(125,211,252,0); }
        }
        .delta-pulse-dot { animation: deltaPulseDot 1.8s ease-in-out infinite; }
      `}</style>

      {/* Animated grid overlay */}
      <div className="absolute inset-0 delta-grid-anim pointer-events-none" />


      {/* Center content */}
      <div className="relative z-10 flex flex-col items-center px-10 text-center">

        {/* Delta logo floating */}
        <div className="delta-logo-float mb-8">
          <img
            src="/logo.png"
            alt="Delta Institutions"
            style={{
              height: 80, width: 'auto', objectFit: 'contain',
              filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.35))',
            }}
            draggable={false}
          />
        </div>

        {/* KHDA Badge */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.30)',
            borderRadius: 9999,
            padding: '6px 16px',
            marginBottom: 20,
            color: 'white',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '3px',
            textTransform: 'uppercase',
          }}
        >
          <span
            className="delta-pulse-dot"
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#7DD3FC', flexShrink: 0, display: 'inline-block',
            }}
          />
          Dubai · UAE · KHDA Approved
        </motion.div>

        {/* Main heading */}
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          style={{
            fontFamily: 'var(--font-display), sans-serif',
            fontSize: 'clamp(30px, 3.2vw, 50px)',
            fontWeight: 900,
            textTransform: 'uppercase',
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            color: 'white',
            marginBottom: 12,
          }}
        >
          Welcome to{' '}
          <span style={{ color: '#7DD3FC' }}>Delta</span>
          <br />Institutions
        </motion.h1>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          style={{
            color: 'rgba(255,255,255,0.65)',
            fontSize: 14,
            lineHeight: 1.7,
            maxWidth: 340,
            marginBottom: 40,
          }}
        >
          UAE&apos;s leading trading academy. Complete the form to begin your journey.
        </motion.p>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
          style={{ display: 'flex', gap: 48, marginBottom: 40 }}
        >
          {stats.map(stat => (
            <div key={stat.label} style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 30,
                fontWeight: 900,
                lineHeight: 1,
                color: '#7DD3FC',
                fontFamily: 'var(--font-display), sans-serif',
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: 9,
                color: 'rgba(255,255,255,0.45)',
                textTransform: 'uppercase',
                letterSpacing: '2px',
                marginTop: 4,
                fontWeight: 700,
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>

        {/* Info strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 20,
            fontSize: 12,
            color: 'rgba(255,255,255,0.4)',
          }}
        >
          {infoItems.map(({ Icon, label }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon size={12} /> {label}
            </span>
          ))}
        </motion.div>
      </div>
    </div>
  )
}
