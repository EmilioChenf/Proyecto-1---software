import { apiDownloadResponse } from './api';

export async function downloadReport(filters: Record<string, string>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const response = await apiDownloadResponse(`/admin/reportes/exportar?${new URLSearchParams(filters)}`, { signal });
  const expectedType = filters.formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (!response.headers.get("Content-Type")?.includes(expectedType)) throw new Error("El servidor devolvió un archivo con formato incorrecto.");
  const blob = await response.blob();
  signal?.throwIfAborted();
  if (!blob.size) throw new Error("El servidor devolvió un archivo vacío.");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    const supplied = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1];
    anchor.download = supplied?.replace(/[\\/\u0000-\u001f]/g, '_') || `nexus-${filters.reporte}.${filters.formato}`;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
