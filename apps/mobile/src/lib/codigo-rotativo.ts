import { generarToken, type MaterialQr, TOKEN_ROTACION_SEGUNDOS } from '@ticketing/shared';
import { useEffect, useMemo, useState } from 'react';

const ventanaActual = () => Math.floor(Date.now() / 1000 / TOKEN_ROTACION_SEGUNDOS);

/**
 * Código rotativo. El token (una firma Ed25519) se recalcula SOLO cuando cambia la ventana
 * de 15 s, no en cada render: el reloj de 1 s actualiza el contador, el useMemo depende de
 * la ventana. Todo es local: funciona en modo avión.
 */
export function useCodigoRotativo(material: MaterialQr | null, privada: Uint8Array | null) {
  const [ventana, setVentana] = useState(ventanaActual);
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      const ahora = Date.now() / 1000;
      setSegundos(Math.ceil(TOKEN_ROTACION_SEGUNDOS - (ahora % TOKEN_ROTACION_SEGUNDOS)));
      setVentana((v) => {
        const n = ventanaActual();
        return n === v ? v : n;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const token = useMemo(
    () => (material && privada ? generarToken(material, privada, Math.floor(Date.now() / 1000)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [material, privada, ventana],
  );

  return { token, segundosParaRotar: segundos };
}
