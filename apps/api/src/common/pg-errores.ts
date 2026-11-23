import { ErrorApi } from './errores';

/**
 * Traduce violaciones de restricciones de PostgreSQL a errores de API accionables.
 * Las reglas viven en la base (CHECK, UNIQUE, EXCLUDE, FK); aquí solo se les pone nombre
 * para el cliente, en vez de devolver un 500.
 */
const POR_RESTRICCION: Record<string, [number, string, string]> = {
  zonas_no_sobreventa: [409, 'aforo_menor_que_ocupado', 'El aforo no puede ser menor que lo ya vendido y reservado'],
  zonas_nombre_uk: [409, 'zona_duplicada', 'Ya existe una zona con ese nombre en el evento'],
  fases_precio_sin_solape: [409, 'fases_solapadas', 'La fase se solapa con otra fase de la misma zona'],
  fases_precio_fase_uk: [409, 'fase_duplicada', 'La zona ya tiene esa fase'],
  fases_precio_rango: [400, 'rango_invalido', '`desde` debe ser anterior a `hasta`'],
  eventos_codigo_uk: [409, 'codigo_duplicado', 'Ya existe un evento con ese código'],
  eventos_fechas: [400, 'fechas_invalidas', 'La venta debe abrir antes del evento y el reembolso cerrar antes o en la fecha del evento'],
  puertas_nombre_uk: [409, 'puerta_duplicada', 'Ya existe una puerta con ese nombre en el evento'],
  // Los turnos referencian la asignación: no se borra el registro de quién escaneó.
  turnos_staff_asignado_fk: [409, 'staff_con_turnos', 'El staff ya tiene turnos registrados en este evento'],
};

const CODIGOS_RESTRICCION = new Set(['23505', '23514', '23P01', '23503']);

export async function traducirPg<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code && CODIGOS_RESTRICCION.has(err.code)) {
      const t = err.constraint ? POR_RESTRICCION[err.constraint] : undefined;
      if (t) throw new ErrorApi(t[0], t[1], t[2]);
      throw new ErrorApi(409, 'restriccion_violada', `La operación viola una regla de datos (${err.constraint ?? err.code})`);
    }
    throw e;
  }
}
