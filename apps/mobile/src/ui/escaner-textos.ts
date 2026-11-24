/** Textos compartidos por la cámara del escáner y el resumen del turno. */

/** Motivo de rechazo (como lo guarda SQLite) → texto para el staff. */
export const MOTIVO: Record<string, string> = {
  ya_usada: 'ya usada',
  revocada: 'revocada',
  expirado: 'código expirado',
  otro_evento: 'otro evento',
  otra_zona: 'zona equivocada',
  firma_invalida: 'código inválido',
  formato_invalido: 'código inválido',
  credencial_vencida: 'credencial vencida',
};

export function textoSync(iso: string | null) {
  if (!iso) return 'Nunca sincronizado';
  const seg = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return seg < 60 ? `Sincronizado hace ${seg} s` : `Sincronizado hace ${Math.round(seg / 60)} min`;
}
