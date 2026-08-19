#!/bin/bash
# Replaces electron-builder's default deb postinst.
#
# The stock template decides whether chrome-sandbox needs its setuid bit by
# probing `unshare --user true` — but postinst runs as ROOT, and root is exempt
# from the unprivileged-user-namespace restriction Ubuntu 24.04 turned on
# (kernel.apparmor_restrict_unprivileged_userns). So the probe reports
# "namespaces work", chmod 0755 is applied, and then the app — running as a
# normal user, where the restriction does apply — falls back to the SUID helper
# and finds it not setuid:
#
#   The SUID sandbox helper binary was found, but is not configured correctly.
#   [...] /opt/OXESpace/chrome-sandbox is owned by root and has mode 4755
#
# Setting it unconditionally is what Chrome's own package does. It costs
# nothing where user namespaces are available: Electron prefers that path and
# only reaches for the helper when the kernel refuses.

set -e

if type update-alternatives 2>/dev/null >&1; then
    # Remove a previous link that predates update-alternatives.
    if [ -L '/usr/bin/${executable}' ] && [ -e '/usr/bin/${executable}' ] && [ "$(readlink '/usr/bin/${executable}')" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 \
        || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# The one line this script exists for. Not conditional, and not silenced: if the
# sandbox helper cannot be secured the install should say so rather than hand
# over an app that aborts at launch.
chown root:root '/opt/${sanitizedProductName}/chrome-sandbox'
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox'

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
