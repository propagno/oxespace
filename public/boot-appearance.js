// Before the first paint: the light/dark and motion the person chose in Settings, so the boot splash and the window
// never flash the other mode. System leaves data-mode unset and the stylesheet follows the operating system.
// A classic script from the app's own files (the window's policy allows only 'self'), loaded and run before <body>.
// Same key and values as src/design/mode.ts and motion.ts; tests/boot-appearance.test.ts runs this file.
try {
  var saved = JSON.parse(localStorage.getItem('oxe-settings') || '{}').state || {}
  if (saved.appearance === 'light' || saved.appearance === 'dark') document.documentElement.dataset.mode = saved.appearance
  if (saved.motion === 'reduce' || saved.motion === 'full') document.documentElement.dataset.motion = saved.motion
} catch (error) { /* no saved choice: the system's applies */ }
