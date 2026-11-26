# OXE-434: extracted from legacy install-over.yml (G4/G8/B13 Windows upgrade + shipped-exe + rollback + uninstall).
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('install-from', 'build-candidate', 'install-candidate', 'enable-inspect', 'verify-shipped-exe', 'rollback-reinstall', 'rollback-restore', 'uninstall')]
  [string]$Phase
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

switch ($Phase) {
  'install-from' {
    New-Item -ItemType Directory -Force -Path $env:OXESPACE_UPGRADE_STATE, "$env:RUNNER_TEMP\from" | Out-Null
    $version = $env:FROM_TAG.TrimStart('v')
    $installer = "OXESpace-$version-x64.exe"
    gh release download $env:FROM_TAG --repo $env:GITHUB_REPOSITORY --pattern $installer --pattern SHA256SUMS.txt --dir "$env:RUNNER_TEMP\from"
    $expected = (Select-String -Path "$env:RUNNER_TEMP\from\SHA256SUMS.txt" -Pattern ([regex]::Escape($installer))).Line.Split(' ')[0]
    $actual = (Get-FileHash "$env:RUNNER_TEMP\from\$installer" -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw "Checksum mismatch for ${installer}: $actual, published $expected" }
    $p = Start-Process "$env:RUNNER_TEMP\from\$installer" -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "$installer /S exited with $($p.ExitCode)" }
    Write-Host "Installed $env:FROM_TAG in $env:LOCALAPPDATA\Programs\OXESpace"
  }

  'build-candidate' {
    npm version $env:CANDIDATE_VERSION --no-git-tag-version --allow-same-version
    $channel = if ($env:CANDIDATE_VERSION -match '-') { 'beta' } else { 'latest' }
    npm run rebuild:native:node
    npm run build
    npm run fix:native
    npm run verify:native
    npx electron-builder --win --config.npmRebuild=false --config.publish.channel=$channel --publish never
    $installer = "dist\OXESpace-$env:CANDIDATE_VERSION-x64.exe"
    if (-not (Test-Path -LiteralPath $installer)) { throw "No installer at $installer" }
    '[installer-size] {0} {1:N1} MB' -f $installer, ((Get-Item $installer).Length / 1MB)
  }

  'install-candidate' {
    $p = Start-Process "dist\OXESpace-$env:CANDIDATE_VERSION-x64.exe" -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "candidate /S exited with $($p.ExitCode)" }
  }

  'enable-inspect' {
    $exe = Join-Path $env:LOCALAPPDATA 'Programs\OXESpace\OXESpace.exe'
    node scripts/check-fuses.mjs --app $exe
    $shipped = Join-Path $env:RUNNER_TEMP 'OXESpace.shipped.exe'
    Copy-Item $exe $shipped
    npx --no-install @electron/fuses write --app $exe EnableNodeCliInspectArguments=on
    node scripts/check-fuses.mjs --app $exe --test-copy-of $shipped
  }

  'verify-shipped-exe' {
    $exe = Join-Path $env:LOCALAPPDATA 'Programs\OXESpace\OXESpace.exe'
    Copy-Item -Force (Join-Path $env:RUNNER_TEMP 'OXESpace.shipped.exe') $exe
    node scripts/check-fuses.mjs --app $exe
    $out = 'upgrade-state/shipped-exe'
    New-Item -ItemType Directory -Force $out | Out-Null
    $log = Join-Path $env:APPDATA 'OXESpace\logs\main.log'
    $skip = if (Test-Path $log) { @(Get-Content $log).Count } else { 0 }
    $p = Start-Process $exe -PassThru -RedirectStandardOutput "$out/stdout.txt" -RedirectStandardError "$out/stderr.txt"
    Start-Sleep -Seconds 25
    $alive = -not $p.HasExited
    $windows = @(Get-Process | Where-Object { $_.ProcessName -match '^OXESpace' -and $_.MainWindowHandle -ne 0 } |
      ForEach-Object { "pid $($_.Id): '$($_.MainWindowTitle)'" })
    "alive after 25 s: $alive$(if (-not $alive) { "; exit code $($p.ExitCode)" })" | Tee-Object "$out/result.txt"
    "windows: $($windows -join '; ')" | Tee-Object -Append "$out/result.txt"
    $errors = @()
    if (Test-Path $log) {
      Copy-Item $log "$out/main.log"
      $mine = @(Get-Content $log | Select-Object -Skip $skip)
      $mine | Set-Content "$out/main.this-launch.log"
      $errors = @($mine | Where-Object { $_ -match '\] \[error\] ' })
      Write-Host "--- main.log, this launch ($($mine.Count) lines) ---"; $mine | Write-Host; Write-Host '--- end ---'
    } else { 'no main.log' | Tee-Object -Append "$out/result.txt" }
    "error lines in main.log: $($errors.Count)" | Tee-Object -Append "$out/result.txt"
    $errors | ForEach-Object { Write-Host "::error title=main.log::$_" }
    $closer = 'already gone'
    if ($alive) {
      Get-Process | Where-Object { $_.ProcessName -match '^OXESpace' -and $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() }
      $closer = 'window closed'
      $deadline = (Get-Date).AddSeconds(10)
      while ((Get-Process | Where-Object { $_.ProcessName -match '^OXESpace' }) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
      if (Get-Process | Where-Object { $_.ProcessName -match '^OXESpace' }) {
        Get-Process | Where-Object { $_.ProcessName -match '^OXESpace' } | Stop-Process -Force -ErrorAction SilentlyContinue
        $closer = 'forced after 10 s (the window did not quit the app)'
        Start-Sleep -Seconds 3
      }
    }
    "ended by: $closer" | Tee-Object -Append "$out/result.txt"
    $wal = Join-Path $env:APPDATA 'OXESpace\oxespace.sqlite3-wal'
    "wal after quit: $(if (Test-Path $wal) { (Get-Item $wal).Length } else { 'none' }) bytes" | Tee-Object -Append "$out/result.txt"
    if (-not $alive) { throw 'the shipped exe exited within 25 s on the upgraded profile' }
    if ($windows.Count -eq 0) { throw 'the shipped exe runs but shows no window after 25 s' }
    if ($errors.Count -gt 0) { throw "main.log has $($errors.Count) error line(s); see the annotations" }
  }

  'rollback-reinstall' {
    $version = $env:FROM_TAG.TrimStart('v')
    "FROM_VERSION=$version" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
    $p = Start-Process "$env:RUNNER_TEMP\from\OXESpace-$version-x64.exe" -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "$env:FROM_TAG /S over the candidate exited with $($p.ExitCode)" }
  }

  'rollback-restore' {
    $seed = Get-Content -Raw "$env:OXESPACE_UPGRADE_STATE\seed.json" | ConvertFrom-Json
    $userData = $seed.userData
    Get-Process -Name OXESpace -ErrorAction SilentlyContinue | Stop-Process -Force
    $backup = Get-ChildItem "$userData\db-backups" -Filter "oxespace-v$($seed.dbVersion)-*.sqlite3" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $backup) {
      $up = Get-Content -Raw "$env:OXESPACE_UPGRADE_STATE\verify-upgrade.json" | ConvertFrom-Json
      if (-not $up.noMigration) { throw "Schema moved but no db-backups\oxespace-v$($seed.dbVersion)-*.sqlite3 in $userData" }
      Write-Host "No db-backups\oxespace-v$($seed.dbVersion)-*.sqlite3: $($up.noMigration)"; exit 0
    }
    foreach ($suffix in '', '-wal', '-shm') { Remove-Item -LiteralPath "$userData\oxespace.sqlite3$suffix" -Force -ErrorAction SilentlyContinue }
    Copy-Item -LiteralPath $backup.FullName -Destination "$userData\oxespace.sqlite3"
    Write-Host "Restored $($backup.Name) to $userData\oxespace.sqlite3"
  }

  'uninstall' {
    $uninstaller = "$env:LOCALAPPDATA\Programs\OXESpace\Uninstall OXESpace.exe"
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw "No uninstaller at $uninstaller" }
    $p = Start-Process $uninstaller -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "uninstaller /S exited with $($p.ExitCode)" }
    for ($i = 0; $i -lt 60 -and (Test-Path -LiteralPath "$env:LOCALAPPDATA\Programs\OXESpace\OXESpace.exe"); $i++) { Start-Sleep -Seconds 2 }
  }
}
