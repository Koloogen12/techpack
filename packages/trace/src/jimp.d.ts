declare module 'jimp' {
  interface JimpImage {
    bitmap: { width: number; height: number; data: Buffer };
  }
  const Jimp: { read(source: Buffer | string): Promise<JimpImage> };
  export default Jimp;
}
