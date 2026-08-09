import * as React from 'react'

/**
 * Minimal inline icon set (flat, stroke 1.75) matching the brand's Lucide
 * convention without pulling a full icon dependency. Add icons as needed.
 */
type IconProps = React.SVGProps<SVGSVGElement>

function Svg({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const X = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
)
export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
)
export const Phone = (p: IconProps) => (
  <Svg {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </Svg>
)
export const ChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
)
export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
)
export const Gift = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
    <path d="M12 8H7.5a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8zM12 8h4.5a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8z" />
  </Svg>
)
export const Search = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
)
export const QrCode = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM21 14v3M14 21h7M21 21v.01" />
  </Svg>
)
export const Camera = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
    <circle cx="12" cy="13" r="3" />
  </Svg>
)
export const Download = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </Svg>
)
export const AlertTriangle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Svg>
)
export const ShieldCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
)
export const LayoutDashboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </Svg>
)
export const CreditCard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20" />
  </Svg>
)
export const Clock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
)
export const Mail = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 6L2 7" />
  </Svg>
)
export const Loader = (p: IconProps) => (
  <Svg {...p} className={['animate-spin', p.className].filter(Boolean).join(' ')}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Svg>
)
export const Heart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />
  </Svg>
)
export const Sparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
  </Svg>
)
export const Menu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
)
