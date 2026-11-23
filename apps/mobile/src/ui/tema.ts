/** Mismos tokens que el portal web (apps/admin/src/index.css), para que se sientan hermanos. */
export const color = {
  fondo: '#f6f4fa',
  tarjeta: '#ffffff',
  borde: '#ebe6f2',
  texto: '#120d1f',
  suave: '#6b6580',
  primario: '#6b239e',
  primario2: '#c2338a',
  primarioSuave: '#f1e8f8',
  primarioTexto: '#ffffff',
  noche: '#120d1f',
  exito: '#0f9d58',
  alerta: '#c26a00',
  acento: '#f5991d',
  error: '#d93025',
  info: '#12a597',
};

export const espacio = { xs: 4, s: 8, m: 14, l: 20, xl: 28 };
export const radio = { s: 12, m: 18, l: 24 };

/** Sombra suave, como `--sombra` de la web. */
export const sombra = {
  shadowColor: '#120d1f',
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
} as const;

export const pesos = (centesimos: number) =>
  `US$ ${(centesimos / 100).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-PA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Día y mes por separado, para el "calendario" de las tarjetas. */
export const diaMes = (iso: string) => {
  const d = new Date(iso);
  return { dia: String(d.getDate()), mes: d.toLocaleString('es-PA', { month: 'short' }).replace('.', '').toUpperCase() };
};
