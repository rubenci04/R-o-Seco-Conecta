import { ExternalLink as ExternalIcon } from 'lucide-react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Enlace a un sitio de terceros. Abre en pestaña nueva sin filtrar el origen. */
export function ExternalLink({
  href,
  children,
  className,
  icon = true,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode; icon?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-1.5', className)} {...rest}>
      {children}
      {icon && <ExternalIcon className="size-4 shrink-0" aria-hidden />}
      <span className="sr-only">(se abre en una pestaña nueva)</span>
    </a>
  )
}
