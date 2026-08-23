/** Kecilkan foto sebelum dikirim ke model vision — resolusi penuh tidak perlu. */
export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('gagal membaca file'));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error('gagal memuat gambar'));
      img.onload = () => {
        const max = 1200;
        let { width, height } = img;
        if (width > height && width > max) { height *= max / width; width = max; }
        else if (height >= width && height > max) { width *= max / height; height = max; }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
