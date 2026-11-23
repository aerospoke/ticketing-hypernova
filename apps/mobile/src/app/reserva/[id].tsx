import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, mensajeDeError } from '../../lib/api';
import { useConsulta } from '../../lib/usar';
import { Aviso, Boton, Cargando, ErrorVista, s, Tarjeta } from '../../ui/componentes';
import { Icono } from '../../ui/icono';
import { color, pesos } from '../../ui/tema';

interface Reserva {
  id: string;
  cantidad: number;
  precio_unitario_centesimos: number;
  monto_centesimos: number;
  estado: 'activa' | 'pagada' | 'expirada' | 'cancelada';
  expira_en: string;
  segundos_restantes: number;
}
interface Compra {
  id: string;
  estado: 'pagada' | 'reembolso_automatico';
  entradas: { id: string }[];
}

export default function ReservaPantalla() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { datos, error, cargando, recargar } = useConsulta(() => api<Reserva>(`/v1/reservas/${id}`), [id]);
  const [restante, setRestante] = useState<number | null>(null);
  const [enviando, setEnviando] = useState<'pago' | 'cancelar' | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [compra, setCompra] = useState<Compra | null>(null);
  // Una clave por intención de pago: si el usuario toca dos veces o se corta la red y
  // reintenta, se reusa la misma y el servidor devuelve la misma compra (un solo cobro).
  const clavePago = useRef(`pago-${randomUUID()}`);

  // Contador: parte de los segundos que informa el servidor y descuenta localmente.
  useEffect(() => {
    if (!datos || datos.estado !== 'activa') return;
    const fin = Date.now() + datos.segundos_restantes * 1000;
    const t = setInterval(() => setRestante(Math.max(0, Math.round((fin - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [datos]);

  if (cargando && !datos) return <Cargando />;
  if (error || !datos) return <ErrorVista error={error} reintentar={() => void recargar()} />;

  async function pagar() {
    setEnviando('pago');
    setFallo(null);
    try {
      const c = await api<Compra>(`/v1/reservas/${id}/pago`, { metodo: 'POST', clave: clavePago.current });
      setCompra(c);
    } catch (e) {
      setFallo(mensajeDeError(e));
    } finally {
      setEnviando(null);
    }
  }

  async function cancelar() {
    setEnviando('cancelar');
    try {
      await api(`/v1/reservas/${id}/cancelar`, { metodo: 'POST', clave: `cancel-${id}` });
      router.replace('/(asistente)');
    } catch (e) {
      setFallo(mensajeDeError(e));
      setEnviando(null);
    }
  }

  if (compra) {
    const ok = compra.estado === 'pagada';
    return (
      <View style={[s.pantalla, s.centro]}>
        <Icono nombre={ok ? 'listo' : 'cerrar'} tam={72} />
        <Text style={[s.titulo, { color: ok ? color.exito : color.alerta }]}>{ok ? '¡Listo! Pago confirmado' : 'Pago devuelto'}</Text>
        <Text style={[s.suave, { textAlign: 'center' }]}>
          {ok
            ? `Tus ${compra.entradas.length} entrada(s) ya están en tu billetera.`
            : 'La reserva venció y ya no quedaba cupo: el cobro se devolvió automáticamente.'}
        </Text>
        <Boton texto="Ver mis entradas" onPress={() => router.replace('/(asistente)/billetera')} estilo={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  const seg = restante ?? datos.segundos_restantes;
  const vencida = datos.estado === 'expirada' || (datos.estado === 'activa' && seg <= 0);
  const mm = String(Math.floor(seg / 60)).padStart(2, '0');
  const ss = String(seg % 60).padStart(2, '0');

  return (
    <ScrollView style={s.pantalla} contentContainerStyle={s.contenido}>
      <Tarjeta estilo={{ alignItems: 'center' }}>
        <Text style={s.suave}>{vencida ? 'La reserva venció' : 'Tiempo para pagar'}</Text>
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 48, fontWeight: '800', color: seg < 60 ? color.error : color.texto, fontVariant: ['tabular-nums'] }}>
          {vencida ? '00:00' : `${mm}:${ss}`}
        </Text>
      </Tarjeta>
      <Tarjeta>
        <View style={s.fila}><Text style={s.texto}>{datos.cantidad} × {pesos(datos.precio_unitario_centesimos)}</Text><Text style={s.subtitulo}>{pesos(datos.monto_centesimos)}</Text></View>
        <Text style={s.suave}>Precio congelado al reservar. El pago es simulado.</Text>
      </Tarjeta>
      {vencida ? <Aviso tipo="alerta" texto="Si pagas ahora y todavía hay cupo, se emiten tus entradas; si no, el cobro se devuelve solo." /> : null}
      {datos.estado === 'cancelada' ? <Aviso tipo="info" texto="Esta reserva fue cancelada." /> : null}
      {fallo ? <Aviso tipo="error" texto={fallo} /> : null}
      <Boton texto="Pagar" onPress={pagar} cargando={enviando === 'pago'} deshabilitado={datos.estado === 'cancelada' || enviando === 'cancelar'} />
      {datos.estado === 'activa' && !vencida ? (
        <Boton texto="Cancelar reserva" variante="secundario" onPress={cancelar} cargando={enviando === 'cancelar'} deshabilitado={enviando === 'pago'} />
      ) : (
        <Boton texto="Volver a la cartelera" variante="secundario" onPress={() => router.replace('/(asistente)')} />
      )}
    </ScrollView>
  );
}
