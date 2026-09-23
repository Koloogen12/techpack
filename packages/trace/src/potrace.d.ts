declare module 'potrace' {
  export interface PotraceOptions {
    turnPolicy?: 'black' | 'white' | 'left' | 'right' | 'minority' | 'majority';
    turdSize?: number;
    alphaMax?: number;
    optCurve?: boolean;
    optTolerance?: number;
    threshold?: number;
    blackOnWhite?: boolean;
    color?: string;
    background?: string;
    width?: number;
    height?: number;
  }
  export function trace(
    source: Buffer | string,
    options: PotraceOptions,
    callback: (error: Error | null, svg: string) => void,
  ): void;
}
