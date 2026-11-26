#!/usr/bin/env bash
# OXE-434: extracted from legacy install-over.yml (G4/G8/B13 Linux deb/AppImage upgrade + rollback + uninstall).
set -euo pipefail

phase="${1:?phase required}"

case "$phase" in
  download-from)
    mkdir -p "$OXESPACE_UPGRADE_STATE" "$RUNNER_TEMP/from"
    version="${FROM_TAG#v}"
    if [ "$OXESPACE_INSTALL_KIND" = deb ]; then file="OXESpace-$version-amd64.deb"; else file="OXESpace-$version-x64.AppImage"; fi
    gh release download "$FROM_TAG" --repo "$GITHUB_REPOSITORY" --pattern "$file" --pattern SHA256SUMS.txt --dir "$RUNNER_TEMP/from"
    expected=$(grep -F "$file" "$RUNNER_TEMP/from/SHA256SUMS.txt" | awk '{print tolower($1)}')
    actual=$(sha256sum "$RUNNER_TEMP/from/$file" | awk '{print $1}')
    [ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "::error::checksum mismatch for $file: $actual, published $expected"; exit 1; }
    chmod +x "$RUNNER_TEMP/from/$file"
    mkdir -p "$RUNNER_TEMP/from-pristine" && cp "$RUNNER_TEMP/from/$file" "$RUNNER_TEMP/from-pristine/$file"
    {
      echo "FROM_PRISTINE=$RUNNER_TEMP/from-pristine/$file"
      echo "FROM_FILE=$RUNNER_TEMP/from/$file"
      echo "FROM_VERSION=$version"
    } >> "$GITHUB_ENV"
    ;;

  install-from)
    if [ "$OXESPACE_INSTALL_KIND" = deb ]; then
      sudo apt-get install -y "$FROM_FILE"
      echo "OXESPACE_EXECUTABLE=/opt/OXESpace/oxespace" >> "$GITHUB_ENV"
      ls -l /opt/OXESpace/oxespace /opt/OXESpace/chrome-sandbox
    else
      echo "OXESPACE_EXECUTABLE=$FROM_FILE" >> "$GITHUB_ENV"
    fi
    ;;

  build-candidate)
    npm version "$CANDIDATE_VERSION" --no-git-tag-version --allow-same-version
    case "$CANDIDATE_VERSION" in *-*) channel=beta ;; *) channel=latest ;; esac
    npm run rebuild:native:node
    npm run build
    npm run fix:native
    npm run verify:native
    npx electron-builder --linux --config.npmRebuild=false --config.publish.channel="$channel" --publish never
    deb=$(ls dist/*.deb | head -1)
    appimage=$(ls dist/*.AppImage | head -1)
    if [ -z "$deb" ] || [ -z "$appimage" ]; then echo "::error::missing .deb or AppImage in dist/"; ls dist; exit 1; fi
    chmod +x "$appimage"
    echo "CANDIDATE_DEB=$PWD/$deb" >> "$GITHUB_ENV"
    echo "CANDIDATE_APPIMAGE=$PWD/$appimage" >> "$GITHUB_ENV"
    ls -l "$deb" "$appimage"
    ;;

  install-candidate)
    if [ "$OXESPACE_INSTALL_KIND" = deb ]; then
      sudo apt-get install -y "$CANDIDATE_DEB"
    else
      echo "OXESPACE_EXECUTABLE=$CANDIDATE_APPIMAGE" >> "$GITHUB_ENV"
    fi
    ;;

  enable-inspect)
    check="$GITHUB_WORKSPACE/scripts/check-fuses.mjs"
    if [ "$OXESPACE_INSTALL_KIND" = deb ]; then
      bin=/opt/OXESpace/oxespace
    else
      rm -rf "$RUNNER_TEMP/appimage" && mkdir -p "$RUNNER_TEMP/appimage"
      (cd "$RUNNER_TEMP/appimage" && "$CANDIDATE_APPIMAGE" --appimage-extract >/dev/null)
      bin="$RUNNER_TEMP/appimage/squashfs-root/oxespace"
      echo "OXESPACE_EXECUTABLE=$bin" >> "$GITHUB_ENV"
    fi
    node "$check" --app "$bin"
    cp "$bin" "$RUNNER_TEMP/oxespace.shipped"
    if [ "$OXESPACE_INSTALL_KIND" = deb ]; then
      sudo env "PATH=$PATH" npx --no-install @electron/fuses write --app "$bin" EnableNodeCliInspectArguments=on
    else
      npx --no-install @electron/fuses write --app "$bin" EnableNodeCliInspectArguments=on
    fi
    node "$check" --app "$bin" --test-copy-of "$RUNNER_TEMP/oxespace.shipped"
    echo "SHIPPED_BIN=$bin" >> "$GITHUB_ENV"
    ;;

  verify-shipped-bin)
    if [ "$OXESPACE_INSTALL_KIND" = deb ]; then sudo cp "$RUNNER_TEMP/oxespace.shipped" "$SHIPPED_BIN"; else cp "$RUNNER_TEMP/oxespace.shipped" "$SHIPPED_BIN"; fi
    node scripts/check-fuses.mjs --app "$SHIPPED_BIN"
    out=upgrade-state/shipped-exe && mkdir -p "$out"
    profile="$HOME/.config/OXESpace"; [ -d "$profile" ] || profile="$HOME/.config/oxespace"
    log="$profile/logs/main.log"
    skip=0; [ -f "$log" ] && skip=$(wc -l < "$log")
    Xvfb :97 -screen 0 1280x800x24 >/dev/null 2>&1 & xvfb=$!
    sleep 1
    args=(); [ "$OXESPACE_INSTALL_KIND" = appimage ] && args=(--no-sandbox)
    DISPLAY=:97 "$SHIPPED_BIN" "${args[@]}" >"$out/stdout.txt" 2>"$out/stderr.txt" & app=$!
    sleep 25
    alive=false; kill -0 "$app" 2>/dev/null && alive=true
    windows=$(DISPLAY=:97 xwininfo -root -tree 2>/dev/null | grep -i '"OXESpace"' || true)
    echo "alive after 25 s: $alive" | tee "$out/result.txt"
    echo "windows: ${windows:-none}" | tee -a "$out/result.txt"
    closer='already gone'
    if $alive; then
      kill -TERM "$app"; closer='SIGTERM'
      for _ in $(seq 1 20); do kill -0 "$app" 2>/dev/null || break; sleep 0.5; done
      if kill -0 "$app" 2>/dev/null; then kill -KILL "$app"; closer='forced after 10 s (SIGTERM did not quit the app)'; fi
    fi
    kill "$xvfb" 2>/dev/null || true
    echo "ended by: $closer" | tee -a "$out/result.txt"
    errors=0
    if [ -f "$log" ]; then
      cp "$log" "$out/main.log"
      tail -n +"$((skip + 1))" "$log" > "$out/main.this-launch.log"
      echo "--- main.log, this launch ---"; cat "$out/main.this-launch.log"; echo "--- end ---"
      errors=$(grep -c '\] \[error\] ' "$out/main.this-launch.log" || true)
      grep '\] \[error\] ' "$out/main.this-launch.log" | while read -r line; do echo "::error title=main.log::$line"; done || true
    else
      echo "no main.log under $profile" | tee -a "$out/result.txt"
    fi
    echo "error lines in main.log: $errors" | tee -a "$out/result.txt"
    $alive || { echo "::error::the shipped binary exited within 25 s on the upgraded profile"; exit 1; }
    [ -n "$windows" ] || { echo "::error::the shipped binary runs but shows no window after 25 s"; exit 1; }
    [ "$errors" -eq 0 ] || { echo "::error::main.log has $errors error line(s)"; exit 1; }
    ;;

  rollback-reinstall)
    if [ "$OXESPACE_INSTALL_KIND" = deb ]; then
      sudo apt-get install -y --allow-downgrades "$FROM_FILE"
    else
      ls -l "$RUNNER_TEMP/from"
      install -m 0755 "$FROM_PRISTINE" "$FROM_FILE"
      echo "OXESPACE_EXECUTABLE=$FROM_FILE" >> "$GITHUB_ENV"
    fi
    ;;

  rollback-restore)
    data=$(node -p "require(process.env.OXESPACE_UPGRADE_STATE + '/seed.json').userData")
    pkill -f /opt/OXESpace/oxespace || true
    pkill -f AppImage || true
    if [ "$OXESPACE_INSTALL_KIND" = appimage ]; then install -m 0755 "$FROM_PRISTINE" "$FROM_FILE"; fi
    from=$(node -p "require(process.env.OXESPACE_UPGRADE_STATE + '/seed.json').dbVersion")
    backup=$(ls -t "$data"/db-backups/oxespace-v"$from"-*.sqlite3 2>/dev/null | head -1 || true)
    if [ -z "$backup" ]; then
      if ! node -e "process.exit(require(process.env.OXESPACE_UPGRADE_STATE + '/verify-upgrade.json').noMigration ? 0 : 1)"; then
        echo "::error::Schema moved but no oxespace-v$from backup in $data/db-backups"; exit 1
      fi
      echo "No oxespace-v$from backup: same schema on both releases, nothing to restore"; exit 0
    fi
    rm -f "$data/oxespace.sqlite3" "$data/oxespace.sqlite3-wal" "$data/oxespace.sqlite3-shm"
    cp "$backup" "$data/oxespace.sqlite3"
    echo "Restored $(basename "$backup") to $data/oxespace.sqlite3"
    ;;

  *)
    echo "::error::unknown phase: $phase" >&2
    exit 1
    ;;
esac
