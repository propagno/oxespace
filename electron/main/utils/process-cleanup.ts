export interface DisposableProcess {
  kill(): void
}

export function killProcess(process: DisposableProcess | null | undefined): void {
  if (!process) return
  try {
    process.kill()
  } catch {
    // Process may already be gone; cleanup must remain idempotent.
  }
}
