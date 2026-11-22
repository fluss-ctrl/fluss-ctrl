// Vite's `?raw` imports: the file's text. The contract tests compare openapi.json byte for byte.
declare module '*?raw' {
  const text: string
  export default text
}
