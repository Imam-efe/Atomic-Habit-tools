// BarcodeDetector belum ada di lib.dom.d.ts bawaan TypeScript — deklarasi
// minimal supaya tsc bersih. Hanya bentuk yang dipakai di Nutrition.tsx.
// Referensi: https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
interface DetectedBarcode {
  rawValue: string;
}

declare class BarcodeDetector {
  constructor(options?: { formats: string[] });
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
