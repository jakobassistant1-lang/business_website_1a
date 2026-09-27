// Server-only browser-global shims for pdfjs-dist (what `pdf-parse` wraps).
//
// WHY: pdfjs's legacy build (node_modules/pdfjs-dist/legacy/build/pdf.mjs, the
// only build pdf-parse imports) evaluates `const SCALE_MATRIX = new DOMMatrix()`
// at MODULE SCOPE — the canvas renderer's constant — and only polyfills the
// global from the OPTIONAL native `@napi-rs/canvas` package (a `createRequire`
// at load time). Inside Vercel's bundled route that require fails, so the
// import itself threw `ReferenceError: DOMMatrix is not defined` and every
// study guide / practice-questions request 500'd before any fail-open guard
// could run. Text extraction (`PDFParse#getText`) never renders, so a
// constructible identity-matrix stub is all module init needs. `Path2D` and
// `ImageData` are only touched inside render paths, but pdfjs also checks for
// them at load (warn-only); they get the same treatment so the load is quiet.
//
// Rules: call `installPdfPolyfills()` right BEFORE every `await import("pdf-parse")`
// (a module that throws during evaluation stays errored for the process, so the
// shim must be in place before the FIRST import). Never import pdf-parse at
// module top level. Idempotent; never overwrites a real global.

const IDENTITY_2D = [1, 0, 0, 1, 0, 0] as const;

/** Minimal DOMMatrix: identity fields a..f / m11..m44 plus the mutating and
 *  non-mutating transform methods pdfjs calls, all returning `this` (no math —
 *  nothing in the text path reads the result). */
class DOMMatrixStub {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  m11 = 1;
  m12 = 0;
  m13 = 0;
  m14 = 0;
  m21 = 0;
  m22 = 1;
  m23 = 0;
  m24 = 0;
  m31 = 0;
  m32 = 0;
  m33 = 1;
  m34 = 0;
  m41 = 0;
  m42 = 0;
  m43 = 0;
  m44 = 1;
  is2D = true;
  isIdentity = true;

  constructor(init?: unknown) {
    if (Array.isArray(init) && init.length === 6 && init.every((n) => typeof n === "number")) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init as number[];
      this.m11 = this.a;
      this.m12 = this.b;
      this.m21 = this.c;
      this.m22 = this.d;
      this.m41 = this.e;
      this.m42 = this.f;
      this.isIdentity = init.every((n, i) => n === IDENTITY_2D[i]);
    }
  }
  multiply(): this {
    return this;
  }
  multiplySelf(): this {
    return this;
  }
  preMultiplySelf(): this {
    return this;
  }
  translate(): this {
    return this;
  }
  translateSelf(): this {
    return this;
  }
  scale(): this {
    return this;
  }
  scaleSelf(): this {
    return this;
  }
  inverse(): this {
    return this;
  }
  invertSelf(): this {
    return this;
  }
  toFloat32Array(): Float32Array {
    return new Float32Array([this.a, this.b, this.c, this.d, this.e, this.f]);
  }
}

class Path2DStub {
  constructor(_path?: unknown) {}
  addPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
}

class ImageDataStub {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(a: unknown, b?: unknown, c?: unknown) {
    if (a instanceof Uint8ClampedArray) {
      this.data = a;
      this.width = Number(b) || 0;
      this.height = Number(c) || Math.floor(a.length / 4 / (this.width || 1));
    } else {
      this.width = Number(a) || 0;
      this.height = Number(b) || 0;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    }
  }
}

export const PDF_POLYFILL_NAMES = ["DOMMatrix", "Path2D", "ImageData"] as const;
export type PdfPolyfillName = (typeof PDF_POLYFILL_NAMES)[number];

const STUBS: Record<PdfPolyfillName, unknown> = {
  DOMMatrix: DOMMatrixStub,
  Path2D: Path2DStub,
  ImageData: ImageDataStub,
};

/** Define any of the three globals that are missing. Returns the names it
 *  installed on THIS call (empty when everything was already present — real
 *  browser/canvas globals are never overwritten, and a second call is a no-op). */
export function installPdfPolyfills(): PdfPolyfillName[] {
  const g = globalThis as unknown as Record<string, unknown>;
  const installed: PdfPolyfillName[] = [];
  for (const name of PDF_POLYFILL_NAMES) {
    if (typeof g[name] !== "undefined") continue;
    g[name] = STUBS[name];
    installed.push(name);
  }
  return installed;
}

/** True when the given global is one of OUR stubs (test/diagnostic helper). */
export function isPdfPolyfillStub(name: PdfPolyfillName): boolean {
  return (globalThis as unknown as Record<string, unknown>)[name] === STUBS[name];
}
