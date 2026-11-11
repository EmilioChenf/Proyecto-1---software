/** Reduce una foto del teléfono a JPEG (lado mayor ≤ maxSide) para enviarla ligera. */
export function resizeImageFile(file: File, maxSide = 1280, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new Error("El archivo debe ser una imagen.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No fue posible leer la imagen."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("No fue posible abrir la imagen."));
      image.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        if (!context) { resolve(String(reader.result)); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
