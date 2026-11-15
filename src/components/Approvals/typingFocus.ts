/**
 * OXE-175: true while the person is typing somewhere (a composer, a field, an editor, a terminal). A request that
 * arrives then must not move their focus: the next key they type would answer another agent's request.
 */
export function focusIsEditable(element: Element | null = typeof document === 'undefined' ? null : document.activeElement): boolean {
  if (!element || typeof HTMLElement === 'undefined' || !(element instanceof HTMLElement)) return false
  if (element.classList.contains('xterm-helper-textarea') || element instanceof HTMLTextAreaElement) return true
  if (element instanceof HTMLInputElement) return !element.readOnly
  if (element.isContentEditable) return true
  const editable = element.closest('[contenteditable]')
  return editable !== null && editable.getAttribute('contenteditable') !== 'false'
}
