/**
 * Koordinat kota besar Indonesia, untuk mengatur lokasi kebun tanpa GPS.
 *
 * Data referensi ter-bundle, mengikuti pola holidays.ts dan plants.ts: jarang
 * berubah, ditinjau seperti kode, dan harus tetap ada tanpa bergantung
 * jaringan. Ketelitiannya cukup untuk ramalan hujan — Open-Meteo memakai grid
 * beberapa kilometer, jadi titik pusat kota sudah mewakili.
 */

export interface City {
  name: string;
  lat: number;
  lon: number;
}

export const CITIES_ID: City[] = [
  { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
  { name: 'Bogor', lat: -6.5971, lon: 106.806 },
  { name: 'Depok', lat: -6.4025, lon: 106.7942 },
  { name: 'Tangerang', lat: -6.1783, lon: 106.6319 },
  { name: 'Bekasi', lat: -6.2383, lon: 106.9756 },
  { name: 'Bandung', lat: -6.9175, lon: 107.6191 },
  { name: 'Cirebon', lat: -6.732, lon: 108.5523 },
  { name: 'Semarang', lat: -6.9932, lon: 110.4203 },
  { name: 'Yogyakarta', lat: -7.7956, lon: 110.3695 },
  { name: 'Surakarta (Solo)', lat: -7.5755, lon: 110.8243 },
  { name: 'Surabaya', lat: -7.2575, lon: 112.7521 },
  { name: 'Malang', lat: -7.9666, lon: 112.6326 },
  { name: 'Denpasar', lat: -8.6705, lon: 115.2126 },
  { name: 'Mataram', lat: -8.5833, lon: 116.1167 },
  { name: 'Kupang', lat: -10.1772, lon: 123.607 },
  { name: 'Medan', lat: 3.5952, lon: 98.6722 },
  { name: 'Banda Aceh', lat: 5.5483, lon: 95.3238 },
  { name: 'Padang', lat: -0.9471, lon: 100.4172 },
  { name: 'Pekanbaru', lat: 0.5071, lon: 101.4478 },
  { name: 'Batam', lat: 1.0456, lon: 104.0305 },
  { name: 'Palembang', lat: -2.9761, lon: 104.7754 },
  { name: 'Bandar Lampung', lat: -5.3971, lon: 105.2668 },
  { name: 'Pontianak', lat: -0.0263, lon: 109.3425 },
  { name: 'Banjarmasin', lat: -3.3194, lon: 114.5908 },
  { name: 'Balikpapan', lat: -1.2379, lon: 116.8529 },
  { name: 'Samarinda', lat: -0.4948, lon: 117.1436 },
  { name: 'Makassar', lat: -5.1477, lon: 119.4327 },
  { name: 'Manado', lat: 1.4748, lon: 124.8421 },
  { name: 'Ambon', lat: -3.6954, lon: 128.1814 },
  { name: 'Jayapura', lat: -2.5916, lon: 140.669 },
];
