// `pg` loads `pg-cloudflare` only inside Cloudflare Workers. The OxeQuery worker never runs there, but the
// bundler turns that lazy require into a static import, and the package is not shipped with the app, so the
// worker failed to load on installed builds. This stub takes its place in the bundle.
export class CloudflareSocket {
  constructor() {
    throw new Error('Cloudflare sockets are not available in OXESpace.')
  }
}

export default { CloudflareSocket }
