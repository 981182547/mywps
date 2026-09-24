declare module 'heic-decode' {
  const decode: (o: { buffer: Uint8Array }) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>
  export default decode
}

declare module '@neslinesli93/qpdf-wasm' {
  const create: (o: object) => Promise<unknown>
  export default create
}
