import type { SVGProps } from 'react'

const line = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

// The app mark: a book page with one line highlighted and a ribbon bookmark.
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" {...props}>
      <rect width="512" height="512" rx="112" fill="#1d3f6e" />
      <rect x="136" y="96" width="240" height="320" rx="18" fill="#fffdf8" />
      <rect x="172" y="160" width="112" height="16" rx="8" fill="#cfc5b0" />
      <rect x="160" y="204" width="196" height="44" rx="10" fill="#f4d65e" />
      <rect x="172" y="218" width="168" height="16" rx="8" fill="#1f1c17" />
      <rect x="172" y="276" width="140" height="16" rx="8" fill="#cfc5b0" />
      <rect x="172" y="324" width="156" height="16" rx="8" fill="#cfc5b0" />
      <path d="M300 96h34v86l-17-14-17 14z" fill="#a13a24" />
    </svg>
  )
}

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path {...line} d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
    </svg>
  )
}

export function BookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path {...line} d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z" />
      <path {...line} d="M12 6.5v13" />
    </svg>
  )
}

export function StudyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect {...line} x="4" y="6" width="13" height="14" rx="2" />
      <path {...line} d="M7.5 3.5H18a2 2 0 0 1 2 2V17" />
      <path {...line} d="m7.5 13 2.2 2.2 4-4.4" />
    </svg>
  )
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path {...line} d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle {...line} cx="15" cy="7" r="2" />
      <circle {...line} cx="9" cy="17" r="2" />
    </svg>
  )
}
