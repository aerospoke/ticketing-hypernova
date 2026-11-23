export const color = {
  fondo: '#f4f6f8',
  tarjeta: '#ffffff',
  borde: '#dfe6eb',
  texto: '#092333',
  suave: '#5b6b78',
  primario: '#6b239e',
  primarioTexto: '#ffffff',
  exito: '#0f9d58',
  alerta: '#f5991d',
  error: '#d93025',
  info: '#12c4b2',
};

export const espacio = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };

export const pesos = (centesimos: number) =>
  `US$ ${(centesimos / 100).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-PA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
