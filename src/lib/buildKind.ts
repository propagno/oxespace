/**
 * Whether this window runs the published app (the installer, the AppImage, the .deb) rather than a development or
 * test run. The published renderer always loads from inside app.asar; `npm run dev` loads from the dev server and the
 * e2e runs load the built files from out/renderer. Tools for the people building OXESpace (the design-system viewer)
 * show only outside a published build.
 */
export function isPublishedBuild(href: string = typeof location === 'undefined' ? '' : location.href): boolean {
  return /\.asar[\\/]/i.test(decodeURI(href))
}
