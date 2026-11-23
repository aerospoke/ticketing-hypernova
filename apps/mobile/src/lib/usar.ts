import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { sesionActual, sesionCargada, suscribir } from './sesion';

/** Sesión reactiva: la UI se actualiza al iniciar o cerrar sesión (también si expira). */
export function useSesion() {
  const sesion = useSyncExternalStore(suscribir, sesionActual);
  const cargada = useSyncExternalStore(suscribir, sesionCargada);
  return { sesion, cargada };
}

/** Carga de datos con estados de carga, error y reintento para cada pantalla. */
export function useConsulta<T>(cargar: () => Promise<T>, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ejecutar = useCallback(cargar, deps);

  const recargar = useCallback(
    async (comoRefresco = false) => {
      if (comoRefresco) setRefrescando(true);
      else setCargando(true);
      try {
        setDatos(await ejecutar());
        setError(undefined);
      } catch (e) {
        setError(e);
      } finally {
        setCargando(false);
        setRefrescando(false);
      }
    },
    [ejecutar],
  );

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return { datos, error, cargando, refrescando, recargar };
}
