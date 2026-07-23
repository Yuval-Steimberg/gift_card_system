import { Sparkle } from '@/components/icons'
import { cn } from '@/lib/utils'

/** JAS wordmark. English display lockup is brand-appropriate for the mark. */
export function Logo({ className, invert = false }: { className?: string; invert?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-extrabold tracking-tight',
        invert ? 'text-jas-cream' : 'text-foreground',
        className,
      )}
    >
      <Sparkle className="h-4 w-4 text-primary" />
      <span>Just A Second</span>
    </span>
  )
}
