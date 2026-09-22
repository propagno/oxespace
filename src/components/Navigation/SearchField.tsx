import { Search, X } from 'lucide-react'
import { forwardRef } from 'react'

export const SearchField = forwardRef<HTMLInputElement, {
  className?: string; inputClassName?: string; label: string; placeholder: string
  value: string; onChange: (value: string) => void; shortcut?: string
}>(function SearchField({ className = '', inputClassName = '', label, placeholder, value, onChange, shortcut }, ref) {
  return <div className={`desktop-search ${className}`}><Search size={16} aria-hidden="true" />
    <input ref={ref} className={inputClassName} type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} autoComplete="off" spellCheck={false} />
    {value ? <button type="button" aria-label="Clear search" onClick={() => onChange('')}><X size={14} aria-hidden="true" /></button> : shortcut && <kbd>{shortcut}</kbd>}
  </div>
})
