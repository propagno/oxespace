// Vite `?raw` imports return the file's text content as a string. Used by
// bootstrap.ts to embed the MCP bridge script into the main bundle so it
// never depends on a separate copy step or a resolvable filesystem path.
declare module '*?raw' {
  const content: string
  export default content
}
