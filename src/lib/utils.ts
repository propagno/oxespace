import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind class strings, de-duplicating conflicting utilities.
 *  Foundation for the shadcn/ui primitives ported from Orca (F1). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
