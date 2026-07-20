// Ambient types for `punycode` (npm, v2 — MIT). The package ships no `.d.ts` and
// there is no `@types/punycode` here, so we declare exactly the surface we use.
// We call the userland package (bundled into the content script / popup), never
// Node's deprecated builtin — in a browser bundle the bare specifier resolves to
// node_modules/punycode.
declare module 'punycode' {
  export function toUnicode(input: string): string;
  export function toASCII(input: string): string;
  export function decode(input: string): string;
  export function encode(input: string): string;
  export const ucs2: {
    decode(input: string): number[];
    encode(codePoints: number[]): string;
  };
  const punycode: {
    version: string;
    toUnicode: typeof toUnicode;
    toASCII: typeof toASCII;
    decode: typeof decode;
    encode: typeof encode;
    ucs2: typeof ucs2;
  };
  export default punycode;
}
