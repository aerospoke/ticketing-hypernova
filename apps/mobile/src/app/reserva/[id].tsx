import { randomUUID } from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, mensajeDeError } from '../../lib/api';
import { useConsulta } from '../../lib/usar';
import { Aviso, Boton, Cargando, ErrorVista, s, Tarjeta } from '../../ui/componentes';
import { Icono } from '../../ui/icono';
import { fotoDe, Portada } from '../../ui/portada';
import { color, espacio, fecha, pesos, radio } from '../../ui/tema';

interface Reserva {
  id: string;
  evento_id: string;
  zona_id: string;
  cantidad: number;
  precio_unitario_centesimos: number;
  monto_centesimos: number;
  estado: 'activa' | 'pagada' | 'expirada' | 'cancelada';
  expira_en: string;
  segundos_restantes: number;
}
interface EventoResumen {
  nombre: string;
  fecha: string;
  recinto: string;
  zonas: { id: string; nombre: string }[];
}
interface Compra {
  id: string;
  estado: 'pagada' | 'reembolso_automatico';
  entradas: { id: string }[];
}

export default function ReservaPantalla() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { datos, error, cargando, recargar } = useConsulta(async () => {
    const r = await api<Reserva>(`/v1/reservas/${id}`);
    // El nombre del evento es decorativo: si falla, la reserva se muestra igual.
    const ev = await api<EventoResumen>(`/v1/eventos/${r.evento_id}`).catch(() => null);
    return { r, ev };
  }, [id]);
  const [restante, setRestante] = useState<number | null>(null);
  const [enviando, setEnviando] = useState<'pago' | 'cancelar' | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [compra, setCompra] = useState<Compra | null>(null);
  // Una clave por intención de pago: si el usuario toca dos veces o se corta la red y
  // reintenta, se reusa la misma y el servidor devuelve la misma compra (un solo cobro).
  const clavePago = useRef(`pago-${randomUUID()}`);

  // Contador: parte de los segundos que informa el servidor y descuenta localmente.
  useEffect(() => {
    if (!datos || datos.r.estado !== 'activa') return;
    const fin = Date.now() + datos.r.segundos_restantes * 1000;
    const t = setInterval(() => setRestante(Math.max(0, Math.round((fin - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [datos]);

  if (cargando && !datos) return <Cargando />;
  if (error || !datos) return <ErrorVista error={error} reintentar={() => void recargar()} />;
  const { r, ev } = datos;
  const foto = fotoDe(r.evento_id);

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
      <View style={s.pantalla}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="light" />
        <Portada foto={foto} alto={300} hasta={1}>
          <View style={e.exitoIcono}>
            <View style={e.exitoCirculo}>
              <Icono nombre={ok ? 'listo' : 'cerrar'} tam={64} />
            </View>
          </View>
        </Portada>
        <View style={[s.contenido, { alignItems: 'center', gap: espacio.m }]}>
          <Text style={[s.titulo, { fontSize: 28, color: ok ? color.texto : color.alerta, textAlign: 'center' }]}>{ok ? '¡Nos vemos ahí! 🎉' : 'Pago devuelto'}</Text>
          <Text style={[s.suave, { textAlign: 'center', fontSize: 16, lineHeight: 22 }]}>
            {ok
              ? `Tus ${compra.entradas.length} entrada(s) para ${ev?.nombre ?? 'el evento'} ya están en tu billetera. Funcionan aunque no tengas señal.`
              : 'La reserva venció y ya no quedaba cupo: el cobro se devolvió automáticamente.'}
          </Text>
          <Boton texto="Ver mis entradas" icono="boleto" onPress={() => router.replace('/(asistente)/billetera')} estilo={{ alignSelf: 'stretch', marginTop: espacio.s }} />
          <Boton texto="Volver a la cartelera" variante="secundario" onPress={() => router.replace('/(asistente)')} estilo={{ alignSelf: 'stretch' }} />
        </View>
      </View>
    );
  }

  const seg = restante ?? r.segundos_restantes;
  const vencida = r.estado === 'expirada' || (r.estado === 'activa' && seg <= 0);
  const mm = String(Math.floor(seg / 60)).padStart(2, '0');
  const ss = String(seg % 60).padStart(2, '0');
  const urgente = !vencida && seg < 60;
  const zona = ev?.zonas.find((z) => z.id === r.zona_id)?.nombre;

  return (
    <ScrollView style={s.pantalla} contentContainerStyle={[s.contenido, { paddingTop: espacio.m }]}>
      <Portada foto={foto} alto={250} hasta={0.95} estilo={{ borderRadius: radio.l }}>
        <View style={e.reloj}>
          <Text style={e.relojEtiqueta}>{vencida ? 'LA RESERVA VENCIÓ' : 'TIEMPO PARA PAGAR'}</Text>
          <Text accessibilityLiveRegion="polite" style={[e.relojNumero, urgente && { color: '#ffb4a8' }]}>
            {vencida ? '00:00' : `${mm}:${ss}`}
          </Text>
          <Text style={e.relojEvento} numberOfLines={1}>{ev?.nombre ?? 'Tu reserva'}</Text>
          {ev ? <Text style={e.relojMeta} numberOfLines={1}>{fecha(ev.fecha)} · {ev.recinto}</Text> : null}
        </View>
      </Portada>

      <Tarjeta>
        <Text style={s.etiqueta}>RESUMEN</Text>
        <View style={s.fila}>
          <Text style={s.texto}>{zona ? `${zona} · ` : ''}{r.cantidad} × {pesos(r.precio_unitario_centesimos)}</Text>
        </View>
        <View style={[s.fila, e.totalFila]}>
          <Text style={s.subtitulo}>Total</Text>
          <Text style={{ fontSize: 24, fontWeight: '900', color: color.texto }}>{pesos(r.monto_centesimos)}</Text>
        </View>
        <Text style={s.suave}>🔒 Precio congelado al reservar. El pago es simulado.</Text>
      </Tarjeta>

      {vencida ? <Aviso tipo="alerta" texto="Si pagas ahora y todavía hay cupo, se emiten tus entradas; si no, el cobro se devuelve solo." /> : null}
      {r.estado === 'cancelada' ? <Aviso tipo="info" texto="Esta reserva fue cancelada." /> : null}
      {fallo ? <Aviso tipo="error" texto={fallo} /> : null}
      <Boton texto={`Pagar ${pesos(r.monto_centesimos)}`} onPress={pagar} cargando={enviando === 'pago'} deshabilitado={r.estado === 'cancelada' || enviando === 'cancelar'} />
      {r.estado === 'activa' && !vencida ? (
        <Boton texto="Cancelar reserva" variante="secundario" onPress={cancelar} cargando={enviando === 'cancelar'} deshabilitado={enviando === 'pago'} />
      ) : (
        <Boton texto="Volver a la cartelera" variante="secundario" onPress={() => router.replace('/(asistente)')} />
      )}
    </ScrollView>
  );
}

const e = StyleSheet.create({
  reloj: { position: 'absolute', left: 0, right: 0, bottom: 22, alignItems: 'center', paddingHorizontal: espacio.l },
  relojEtiqueta: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  relojNumero: { color: '#fff', fontSize: 64, fontWeight: '900', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  relojEvento: { color: '#fff', fontSize: 18, fontWeight: '800' },
  relojMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2 },
  totalFila: { borderTopWidth: 1, borderTopColor: color.borde, paddingTop: 12, marginTop: 4 },
  exitoIcono: { position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center' },
  exitoCirculo: { width: 112, height: 112, borderRadius: 56, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});
