import { useEffect, useState } from 'react'
import { motion, useMotionValue, useSpring } from 'motion/react'

/** Completely ignored by custom cursor */
const IGNORE_SELECTORS = [
  '.pagination',
  '[data-cursor-ignore]',
]

const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, [role="button"], [data-cursor]'

const CURSOR_STYLE_ID = 'custom-cursor-style'

/**
 * Layout sizes are static: the dot is `DOT_SIZE`, and hovering scales it up to
 * `RING_SIZE`. Everything that changes at runtime (size, ring) is expressed as
 * `scale`/`opacity`/`backgroundColor`, so the cursor animates on the GPU instead
 * of triggering layout on every mousemove-driven frame.
 */
const DOT_SIZE = 12
const RING_SIZE = 40
/** Multipliers for the two layers; the ring is drawn at its final size and scaled down when hidden. */
const DOT_HOVER_SCALE = RING_SIZE / DOT_SIZE
const RING_HIDDEN_SCALE = DOT_SIZE / RING_SIZE

/** A custom cursor is only meaningful where there is a real, precise mouse. */
const POINTER_QUERY = '(hover: hover) and (pointer: fine)'
/** Respect the OS "reduce motion" setting: keep the native cursor, draw nothing. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function supportsMatchMedia() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

/** Live media-query subscription — plugging in a mouse or toggling reduce-motion applies without a reload. */
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (supportsMatchMedia() ? window.matchMedia(query).matches : false))

  useEffect(() => {
    if (!supportsMatchMedia()) return
    const list = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)

    // Re-read on mount/dep change: the value may have changed between render and effect.
    setMatches(list.matches)
    list.addEventListener('change', onChange)
    return () => {
      list.removeEventListener('change', onChange)
    }
  }, [query])

  return matches
}

export function CustomCursor() {
  const [isHovering, setIsHovering] = useState(false)

  const hasPrecisePointer = useMediaQuery(POINTER_QUERY)
  const prefersReducedMotion = useMediaQuery(REDUCED_MOTION_QUERY)
  const enabled = hasPrecisePointer && !prefersReducedMotion

  const cursorX = useMotionValue(-100)
  const cursorY = useMotionValue(-100)

  const springConfig = { damping: 30, stiffness: 500, mass: 0.6 }
  const smoothX = useSpring(cursorX, springConfig)
  const smoothY = useSpring(cursorY, springConfig)

  useEffect(() => {
    if (!enabled) {
      // Never hide the system cursor on touch / hybrid / reduced-motion devices.
      setIsHovering(false)
      return
    }

    document.getElementById(CURSOR_STYLE_ID)?.remove()
    const style = document.createElement('style')
    style.id = CURSOR_STYLE_ID
    style.textContent = '* { cursor: none !important; }'
    document.head.appendChild(style)

    const onMouseMove = (e: MouseEvent) => {
      cursorX.set(e.clientX)
      cursorY.set(e.clientY)
    }

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      for (const sel of IGNORE_SELECTORS) {
        if (target.closest(sel)) return
      }
      if (target.closest(INTERACTIVE_SELECTOR)) {
        setIsHovering(true)
      }
    }

    const onMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest(INTERACTIVE_SELECTOR)) {
        setIsHovering(false)
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseover', onMouseOver)
    document.addEventListener('mouseout', onMouseOut)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseover', onMouseOver)
      document.removeEventListener('mouseout', onMouseOut)
      style.remove()
    }
  }, [enabled, cursorX, cursorY])

  if (!enabled) return null

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-[9999]"
      style={{
        x: smoothX,
        y: smoothY,
      }}
    >
      {/* Ring: 2px border is static, only scale + opacity animate (no layout, no animated border). */}
      <motion.div
        className="absolute rounded-full border-2"
        style={{
          width: RING_SIZE,
          height: RING_SIZE,
          translateX: '-50%',
          translateY: '-50%',
          borderColor: 'rgba(125, 57, 235, 0.5)',
        }}
        animate={{
          scale: isHovering ? 1 : RING_HIDDEN_SCALE,
          opacity: isHovering ? 1 : 0,
        }}
        transition={{
          type: 'spring',
          damping: 20,
          stiffness: 400,
          mass: 0.6,
        }}
      />
      {/* Dot: 12px base size, scaled up to 40px on interactive hover. */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          translateX: '-50%',
          translateY: '-50%',
        }}
        animate={{
          scale: isHovering ? DOT_HOVER_SCALE : 1,
          backgroundColor: isHovering
            ? 'rgba(125, 57, 235, 0.15)'
            : 'rgba(125, 57, 235, 0.9)',
        }}
        transition={{
          type: 'spring',
          damping: 20,
          stiffness: 400,
          mass: 0.6,
        }}
      />
    </motion.div>
  )
}
