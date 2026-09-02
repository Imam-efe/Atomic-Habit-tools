/**
 * Uji sifat katalog, bukan kebenaran biologisnya.
 *
 * Interval cacingan dan umur ganti UVB tidak bisa dibuktikan lewat tes — sama
 * seperti umur panen di plants.test.ts. Yang bisa dan harus dijaga adalah
 * bentuknya: tidak ada id kembar, tidak ada hewan tanpa tugas, dan tidak ada
 * kolom keselamatan yang lupa diisi.
 */
import { describe, it, expect } from 'vitest';
import { ANIMALS, ANIMAL_BY_ID } from './animals';

describe('katalog hewan', () => {
  it('punya isi', () => {
    expect(ANIMALS.length).toBeGreaterThan(0);
  });

  it('id unik dan peta cocok dengan daftarnya', () => {
    const ids = ANIMALS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ANIMAL_BY_ID.size).toBe(ANIMALS.length);
    for (const a of ANIMALS) expect(ANIMAL_BY_ID.get(a.id)).toBe(a);
  });

  it('setiap hewan punya sekurangnya satu tugas', () => {
    for (const a of ANIMALS) {
      expect(a.tugas.length, `${a.id} tidak punya tugas`).toBeGreaterThan(0);
    }
  });

  it('kode tugas unik dalam satu hewan', () => {
    for (const a of ANIMALS) {
      const kode = a.tugas.map((t) => t.kode);
      expect(new Set(kode).size, `${a.id} punya kode tugas kembar`).toBe(kode.length);
    }
  });

  it('interval tugas positif dan mulaiHari tidak negatif', () => {
    for (const a of ANIMALS) {
      for (const t of a.tugas) {
        expect(t.tiapHari, `${a.id}/${t.kode}`).toBeGreaterThan(0);
        expect(t.mulaiHari, `${a.id}/${t.kode}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('setiap tugas menjelaskan caranya, bukan cuma menamainya', () => {
    for (const a of ANIMALS) {
      for (const t of a.tugas) {
        expect(t.cara.length, `${a.id}/${t.kode} terlalu pendek`).toBeGreaterThan(25);
      }
    }
  });

  it('tugas hanya bersasaran kandang atau hewan', () => {
    for (const a of ANIMALS) {
      for (const t of a.tugas) {
        expect(['kandang', 'hewan']).toContain(t.sasaran);
      }
    }
  });

  it('hewan air punya rentang pH, hewan darat tidak dipaksa punya', () => {
    for (const a of ANIMALS) {
      if (a.habitat === 'darat') continue;
      expect(a.phAir, `${a.id} tanpa phAir`).not.toBeNull();
      expect(a.phAir![0]).toBeLessThan(a.phAir![1]);
    }
  });

  it('hewan laut dan payau punya rentang salinitas', () => {
    for (const a of ANIMALS) {
      if (a.habitat !== 'air-laut' && a.habitat !== 'air-payau') continue;
      expect(a.salinitasPpt, `${a.id} tanpa salinitas`).not.toBeNull();
      expect(a.salinitasPpt![0]).toBeLessThan(a.salinitasPpt![1]);
    }
  });

  it('hewan air tawar tidak punya salinitas', () => {
    for (const a of ANIMALS) {
      if (a.habitat !== 'air-tawar') continue;
      expect(a.salinitasPpt, `${a.id} punya salinitas padahal air tawar`).toBeNull();
    }
  });

  it('umur hidup masuk akal', () => {
    for (const a of ANIMALS) {
      expect(a.umurTahun[0]).toBeGreaterThan(0);
      expect(a.umurTahun[0]).toBeLessThanOrEqual(a.umurTahun[1]);
    }
  });

  it('kolom keselamatan selalu hadir sebagai keputusan', () => {
    // null pun harus disengaja. `in` membedakan "sengaja null" dari "lupa".
    for (const a of ANIMALS) {
      expect('legal' in a, `${a.id} tanpa kolom legal`).toBe(true);
      expect('bahaya' in a, `${a.id} tanpa kolom bahaya`).toBe(true);
    }
  });

  it('semua golongan yang dijanjikan sudah terwakili', () => {
    const grup = new Set(ANIMALS.map((a) => a.grup));
    for (const g of ['mamalia', 'unggas', 'ikan-tawar', 'ikan-laut', 'reptil']) {
      expect(grup.has(g as never), `belum ada ${g}`).toBe(true);
    }
  });

  it('jumlah spesies sesuai janji gelombang pertama', () => {
    expect(ANIMALS.length).toBeGreaterThanOrEqual(60);
  });

  it('tiap golongan punya cukup pilihan untuk berguna', () => {
    const per = new Map<string, number>();
    for (const a of ANIMALS) per.set(a.grup, (per.get(a.grup) ?? 0) + 1);
    for (const [grup, minimal] of [
      ['mamalia', 6], ['unggas', 10], ['ikan-tawar', 14],
      ['ikan-laut', 5], ['reptil', 6], ['ternak-besar', 4],
    ] as const) {
      expect(per.get(grup) ?? 0, `${grup} terlalu sedikit`).toBeGreaterThanOrEqual(minimal);
    }
  });

  it('tiap hewan berhabitat air punya tugas ganti air bersasaran kandang', () => {
    // Ikan yang tidak pernah ditagih ganti air adalah ikan yang mati pelan.
    for (const a of ANIMALS) {
      if (a.habitat === 'darat') continue;
      const ada = a.tugas.some((t) => t.sasaran === 'kandang' && /air/i.test(t.nama));
      expect(ada, `${a.id} tanpa tugas air`).toBe(true);
    }
  });

  it('penting adalah boolean eksplisit pada setiap tugas', () => {
    // Bukan "sekurangnya satu tugas penting per spesies" — tes lama itu
    // mendorong penulis menandai sesuatu jadi penting hanya demi lulus tes,
    // bukan karena kelalaiannya sungguh berujung mati. Yang bisa dijaga
    // tanpa menilai isinya cuma bahwa setiap tugas memang membuat keputusan
    // eksplisit, true atau false, bukan lupa mengisi sama sekali.
    for (const a of ANIMALS) {
      for (const t of a.tugas) {
        expect(typeof t.penting, `${a.id}/${t.kode} penting bukan boolean`).toBe('boolean');
      }
    }
  });

  // `penting` bertipe boolean wajib (bukan opsional) — jadi tes di atas tidak
  // bisa pernah gagal terhadap apa pun yang lolos TypeScript. Itu bukan
  // cakupan. Yang benar-benar bisa salah adalah kode tugas yang sama dipakai
  // beberapa spesies tapi diberi keputusan `penting` yang berbeda tanpa
  // alasan: salah satu dari keduanya pasti keliru, kecuali prosa `cara`-nya
  // sungguh menunjukkan spesies itu berbeda tingkat bahayanya.
  it('penting konsisten untuk kode tugas yang sama di lintas spesies, kecuali dikecualikan dengan alasan tertulis', () => {
    // Setiap entri di sini sudah diverifikasi manual — prosa `cara` tiap
    // kemunculan kodenya dibaca ulang satu per satu — dan perbedaan
    // `penting`-nya memang didukung oleh perbedaan yang ditulis di prosa
    // tersebut, bukan cuma kebetulan penulisan. Kode split yang TIDAK ada di
    // sini berarti belum ada yang memverifikasi bedanya masuk akal, dan tes
    // ini menolaknya sampai diverifikasi (masuk KECUALI) atau disamakan.
    const KECUALI: Record<string, string> = {
      uvb:
        'Kura-kura & iguana: prosa eksplisit menyebut penyakit tulang metabolik ' +
        'dan cangkang cacat permanen tanpa UVB cukup. Leopard gecko & ular: ' +
        'prosa sendiri bilang UVB rendah cuma bonus metabolisme kalsium ' +
        '"tanpa risiko berarti" — bukan kebutuhan, cuma tambahan.',
      'extra-fooding':
        'Kacer: kekurangan protein bikin stres sampai "nyilet" (mencabuti ' +
        'bulu sendiri) — self-harm yang jelas lebih berat dari sekadar ' +
        'kurang bagus. Murai-batu: konsekuensi yang ditulis cuma bulu kusam ' +
        'dan kondisi fisik turun, tidak ada klaim seberat itu.',
      jemur:
        'Ketiga kura-kura (brazil/sulcata/ambon) semuanya true: berjemur ' +
        'adalah kebutuhan termoregulasi dan pencernaan reptil, seserius uvb ' +
        'pada spesies yang sama (yang juga true untuk ketiganya) — bukan ' +
        'preferensi. Burung berbeda kelas keparahan menurut prosa masing- ' +
        'masing: lovebird eksplisit "egg binding yang bisa fatal", perkutut ' +
        'eksplisit cuma "lesu dan kicauannya melemah".',
      'ganti-air':
        'Ikan bervolume kecil (akuarium/wadah tanpa filter, amonia menumpuk ' +
        'cepat), ikan terumbu (parameter air sensitif), kura-kura air, dan ' +
        'axolotl (kulit tanpa sisik sensitif) tetap true — juga lele, yang ' +
        'prosanya eksplisit menyebut "kematian massal" pada kepadatan ' +
        'tinggi meski ikan kolam. Ikan kolam bervolume besar yang prosanya ' +
        'sendiri menyatakan toleran dan konsekuensinya cuma pertumbuhan ' +
        'melambat (koi, nila, patin, gurame, mujair) — false, dengan ' +
        'alasan yang sama dipakai mendemosikan seluruh `cacing` gelombang ' +
        'lalu: klaim produktivitas, bukan klaim kematian.',
    };

    const kemunculanPerKode = new Map<string, Array<{ id: string; penting: boolean }>>();
    for (const a of ANIMALS) {
      for (const t of a.tugas) {
        const list = kemunculanPerKode.get(t.kode) ?? [];
        list.push({ id: a.id, penting: t.penting });
        kemunculanPerKode.set(t.kode, list);
      }
    }

    for (const [kode, kemunculan] of kemunculanPerKode) {
      if (kemunculan.length < 2) continue;
      const nilai = new Set(kemunculan.map((k) => k.penting));
      if (nilai.size <= 1) continue;

      const ringkasan = kemunculan.map((k) => `${k.id}=${k.penting}`).join(', ');
      expect(
        kode in KECUALI,
        `"${kode}" tidak konsisten (${ringkasan}) dan tidak ada di KECUALI — samakan nilainya atau tambahkan alasan tertulis`
      ).toBe(true);
    }

    // Arah sebaliknya: kalau sebuah kode di KECUALI sudah konsisten (semua
    // kemunculannya sama), pengecualiannya basi — sisa dari perbaikan lama
    // yang seharusnya ikut dihapus, bukan alasan yang menjelaskan perbedaan
    // yang sudah tidak ada lagi.
    for (const kode of Object.keys(KECUALI)) {
      const kemunculan = kemunculanPerKode.get(kode) ?? [];
      const nilai = new Set(kemunculan.map((k) => k.penting));
      expect(
        nilai.size,
        `"${kode}" ada di KECUALI tapi semua kemunculannya sudah konsisten — pengecualian ini basi, hapus dari peta`
      ).toBeGreaterThan(1);
    }
  });

  it('anomali penting yang sudah diperbaiki dalam kode yang tetap dikecualikan tidak terulang', () => {
    // ganti-air dan jemur tetap ada di KECUALI (splitnya secara umum masuk
    // akal), tapi masing-masing punya satu-dua kemunculan yang SEBELUM
    // perbaikan ini bertentangan dengan prosanya sendiri. Tes konsistensi di
    // atas tidak bisa mendeteksi anomali seperti ini terulang, karena kode
    // itu tetap "split" (jadi lolos lewat KECUALI) berapa pun kombinasi
    // true/false di dalamnya — jadi diperiksa eksplisit di sini.
    const cari = (id: string, kode: string) =>
      ANIMAL_BY_ID.get(id)?.tugas.find((t) => t.kode === kode)?.penting;

    // gurame & mujair: prosanya sendiri cuma bilang toleran/pertumbuhan
    // melambat (klaim produktivitas, persis alasan demosi cacing), sama
    // seperti koi/nila/patin yang sudah false — bukan seperti lele yang
    // eksplisit "kematian massal".
    expect(cari('gurame', 'ganti-air'), 'gurame/ganti-air').toBe(false);
    expect(cari('mujair', 'ganti-air'), 'mujair/ganti-air').toBe(false);

    // kura-kura-ambon/jemur: prosanya sama persis strukturnya dengan
    // brazil/sulcata (cuma beda angka suhu, tanpa konsekuensi tertulis di
    // manapun), dan spesies yang sama menandai uvb-nya true — berjemur dan
    // UVB sama-sama soal termoregulasi/pencernaan reptil ini.
    expect(cari('kura-kura-ambon', 'jemur'), 'kura-kura-ambon/jemur').toBe(true);
  });

  it('reptil berjemur punya tugas ganti UVB', () => {
    // Lampu UVB berhenti memancarkan UVB jauh sebelum lampunya mati, jadi
    // "masih menyala" bukan tanda ia masih bekerja. Ini penyebab paling umum
    // cangkang bengkok pada kura-kura peliharaan.
    for (const a of ANIMALS) {
      if (a.grup !== 'reptil') continue;
      expect(a.tugas.some((t) => t.kode === 'uvb'), `${a.id} tanpa tugas uvb`).toBe(true);
    }
  });
});

/**
 * `literPerEkor` yang bertentangan dengan `ruangMinimal` di baris yang sama
 * pernah lolos review tiga kali (patin, banggai-cardinal, kepe-kepe) karena
 * tidak ada yang membandingkan keduanya secara mekanis. Fungsi di bawah
 * menguraikan angka liter dari kalimat `ruangMinimal` lalu membandingkannya
 * ke `literPerEkor` — dengan aturan yang beda-beda tergantung bagaimana
 * kalimatnya menyebut jumlah ekor:
 *
 *   - Tidak ada penanda kelompok ("sekelompok"/"kawanan") sama sekali: angka
 *     liternya (atau rentangnya) ADALAH literPerEkor.
 *   - Kepadatan per meter kubik (budidaya kolam/keramba): dikonversi jadi
 *     rentang liter/ekor (1000 / kepadatan), lalu dibandingkan.
 *   - Kelompok dengan jumlah ekor eksplisit dalam kurung, "(A-B ekor)":
 *     volume dibagi rentang itu.
 *   - Kelompok dengan HANYA batas bawah, "kawanan minimal N ekor": literPerEkor
 *     paling banyak volume/N — menambah ekor cuma mengurangi jatah tiap
 *     ekor, tidak pernah menambah.
 *   - Kepadatan per meter PERSEGI (bukan kubik) butuh asumsi kedalaman kolam
 *     yang tidak pernah disebutkan, dan kalimat "sekelompok kecil" tanpa
 *     angka sama sekali tidak punya pembagi yang bisa diambil — keduanya
 *     dianggap TIDAK BISA DIURAIKAN dan harus disebut eksplisit di
 *     `TIDAK_TERURAI`, bukan diam-diam dilewati.
 */
type HasilLiter =
  | { tipe: 'pasti'; nilai: number }
  | { tipe: 'rentang'; lo: number; hi: number }
  | { tipe: 'maksimal'; batas: number }
  | { tipe: 'tidak-terurai'; alasan: string };

function uraikanLiterRuangMinimal(ruangMinimal: string): HasilLiter {
  const perM2 = /(\d+)\s*-\s*(\d+)\s*ekor per meter persegi|(\d+)\s*ekor per meter persegi/.exec(ruangMinimal);
  if (perM2) return { tipe: 'tidak-terurai', alasan: 'kepadatan per meter persegi butuh asumsi kedalaman' };

  const perM3 = /(\d+)\s*-\s*(\d+)\s*ekor per meter kubik/.exec(ruangMinimal);
  if (perM3) {
    const lo = Number(perM3[1]);
    const hi = Number(perM3[2]);
    return { tipe: 'rentang', lo: 1000 / hi, hi: 1000 / lo };
  }

  const adaKelompok = /sekelompok|kelompok|kawanan/.test(ruangMinimal);
  const literMatch = /(\d+)\s*-\s*(\d+)\s*liter|(\d+)\s*liter/.exec(ruangMinimal);

  if (adaKelompok) {
    const dalamKurung = /\((\d+)\s*-\s*(\d+)\s*ekor\)|\((\d+)\s*ekor\)/.exec(ruangMinimal);
    const minimalSaja = /minimal\s+(\d+)\s*ekor/.exec(ruangMinimal);

    if (!literMatch) return { tipe: 'tidak-terurai', alasan: 'kelompok tanpa angka liter yang bisa dipasangkan' };
    const volLo = literMatch[1] ? Number(literMatch[1]) : Number(literMatch[3]);
    const volHi = literMatch[2] ? Number(literMatch[2]) : volLo;

    if (dalamKurung) {
      const cLo = dalamKurung[1] ? Number(dalamKurung[1]) : Number(dalamKurung[3]);
      const cHi = dalamKurung[2] ? Number(dalamKurung[2]) : cLo;
      return { tipe: 'rentang', lo: volLo / cHi, hi: volHi / cLo };
    }
    if (minimalSaja) {
      return { tipe: 'maksimal', batas: volHi / Number(minimalSaja[1]) };
    }
    return { tipe: 'tidak-terurai', alasan: 'kelompok tanpa jumlah ekor eksplisit ("sekelompok kecil")' };
  }

  if (!literMatch) return { tipe: 'tidak-terurai', alasan: 'tidak ada angka liter di ruangMinimal' };
  const lo = literMatch[1] ? Number(literMatch[1]) : Number(literMatch[3]);
  const hi = literMatch[2] ? Number(literMatch[2]) : lo;
  return lo === hi ? { tipe: 'pasti', nilai: lo } : { tipe: 'rentang', lo, hi };
}

describe('literPerEkor konsisten dengan ruangMinimal', () => {
  // Spesies yang prosa ruangMinimal-nya genuinely tidak bisa diuraikan jadi
  // angka liter/ekor — didaftar eksplisit, bukan dilewati diam-diam. Kalau
  // spesies baru jatuh ke sini tanpa didaftarkan, tesnya gagal dan memaksa
  // seseorang memutuskan: tulis ulang prosanya supaya bisa diuraikan, atau
  // tambahkan ke daftar ini dengan sadar.
  const TIDAK_TERURAI = new Set([
    'guppy', 'molly', 'platy', 'sepat', // "sekelompok kecil" tanpa angka ekor
    'nila', 'mujair', 'gurame', // kepadatan per meter PERSEGI, bukan kubik
    'anemon', 'karang-lunak', // tidak ada angka liter sama sekali di kalimatnya
  ]);

  const aquatik = ANIMALS.filter((a) => a.habitat !== 'darat' && a.literPerEkor !== null);

  it('setiap spesies akuatik terhitung: terurai dan cocok, atau eksplisit di TIDAK_TERURAI', () => {
    const takTerdaftarTapiTakTerurai: string[] = [];
    const terdaftarPadahalTerurai: string[] = [];

    for (const a of aquatik) {
      const hasil = uraikanLiterRuangMinimal(a.ruangMinimal);
      const adaDiDaftar = TIDAK_TERURAI.has(a.id);

      if (hasil.tipe === 'tidak-terurai') {
        if (!adaDiDaftar) takTerdaftarTapiTakTerurai.push(`${a.id} (${hasil.alasan})`);
        continue;
      }
      if (adaDiDaftar) { terdaftarPadahalTerurai.push(a.id); continue; }

      const nilai = a.literPerEkor!;
      if (hasil.tipe === 'pasti') {
        expect(nilai, `${a.id}: literPerEkor=${nilai} vs ruangMinimal=${hasil.nilai}`).toBe(hasil.nilai);
      } else if (hasil.tipe === 'rentang') {
        expect(nilai, `${a.id}: literPerEkor=${nilai} di bawah rentang ruangMinimal [${hasil.lo.toFixed(1)}, ${hasil.hi.toFixed(1)}]`)
          .toBeGreaterThanOrEqual(hasil.lo - 0.01);
        expect(nilai, `${a.id}: literPerEkor=${nilai} di atas rentang ruangMinimal [${hasil.lo.toFixed(1)}, ${hasil.hi.toFixed(1)}]`)
          .toBeLessThanOrEqual(hasil.hi + 0.01);
      } else {
        expect(nilai, `${a.id}: literPerEkor=${nilai} melebihi maksimal ${hasil.batas.toFixed(1)} dari ruangMinimal`)
          .toBeLessThanOrEqual(hasil.batas + 0.01);
      }
    }

    expect(takTerdaftarTapiTakTerurai, 'spesies tidak terurai tapi belum didaftar di TIDAK_TERURAI').toEqual([]);
    expect(terdaftarPadahalTerurai, 'spesies di TIDAK_TERURAI padahal sekarang bisa diuraikan — keluarkan dari daftar').toEqual([]);
  });
});
