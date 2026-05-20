param(
  [string]$Name = "OXESpace"
)

Write-Host "OXESpace script smoke test"
Write-Host "Workspace: $(Get-Location)"
Write-Host "Name: $Name"

try {
  $nodeVersion = node --version
} catch {
  $nodeVersion = "node unavailable"
}

Write-Host "Node: $nodeVersion"
Write-Host "Done"
