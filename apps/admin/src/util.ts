import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ErrorApi } from './api'

export const dinero = (c: number) => `US$ ${(c / 100).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// "7 dic 2026, 20:00": sin formatos numéricos ambiguos (12/07 ¿julio o diciembre?).
export const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
/** Para inputs datetime-local (hora local del navegador) <-> ISO con zona. */
export const aLocal = (iso: string) => {
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
export const desdeLocal = (v: string) => new Date(v).toISOString()

export function mensaje(e: unknown) {
  return e instanceof ErrorApi ? e.message : 'Ocurrió un error inesperado'
}

/**
 * Carga con estados de carga/error y recarga periódica opcional (tiempo casi real).
 * `clave` identifica la consulta: si cambia (otro evento, otra búsqueda), se vuelve a cargar
 * y no se muestran los datos de la consulta anterior.
 */
export function useCarga<T>(cargar: () => Promise<T>, clave: string, cadaMs?: number) {
  const fn = useRef(cargar)
  useEffect(() => {
    fn.current = cargar
  })
  const [estado, setEstado] = useState<{ clave?: string; datos?: T; error?: unknown }>({})

  const recargar = useCallback(async () => {
    try {
      const datos = await fn.current()
      setEstado({ clave, datos })
    } catch (error) {
      setEstado((e) => ({ clave, datos: e.clave === clave ? e.datos : undefined, error }))
    }
  }, [clave])

  useEffect(() => {
    void recargar()
    if (!cadaMs) return
    const t = setInterval(() => void recargar(), cadaMs)
    return () => clearInterval(t)
  }, [recargar, cadaMs])

  const vigente = estado.clave === clave
  return { datos: vigente ? estado.datos : undefined, error: vigente ? estado.error : undefined, cargando: !vigente, recargar }
}

/** Router por hash: #/eventos/4/ventas -> ['eventos', '4', 'ventas']. */
function suscribirHash(fn: () => void) {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}
export function useRuta(): string[] {
  const hash = useSyncExternalStore(suscribirHash, () => window.location.hash)
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean)
}
export const ir = (ruta: string) => {
  window.location.hash = ruta
}
