import { randomUUID } from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, mensajeDeError } from '../../lib/api';
import { useConsulta } from '../../lib/usar';
import { Aviso, Boton, Cargando, ErrorVista, s, Tarjeta } from '../../ui/componentes';
import { color, fecha, pesos } from '../../ui/tema';

interface Zona {
  id: string;
  nombre: string;
  aforo: number;
  disponibles: number;
  fase_vigente: { fase: string; precio_centesimos: number; hasta: string } | null;
}
interface Detalle {
  id: string;
  nombre: string;
  recinto: string;
  fecha: string;
  estado_venta: string;
  limite_por_cuenta: number;
  reembolsable_hasta: string;
  zonas: Zona[];
}

export default function Evento() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { datos, error, cargando, refrescando, recargar } = useConsulta(() => api<Detalle>(`/v1/eventos/${id}`), [id]);
  const [zona, setZona] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  // Una clave por intención de compra: el doble toque o el reintento reusan la misma.
  const clave = useRef<string | null>(null);

  if (cargando && !datos) return <Cargando />;
  if (error || !datos) return <ErrorVista error={error} reintentar={() => void recargar()} />;

  const elegida = datos.zonas.find((z) => z.id === zona);
  const maximo = Math.min(datos.limite_por_cuenta, elegida?.disponibles ?? 0, 10);

  async function reservar() {
    if (!elegida) return;
    setEnviando(true);
    setFallo(null);
    clave.current ??= `res-${randomUUID()}`;
    try {
      // Solo se envía zona y cantidad: el precio lo calcula el servidor.
      const r = await api<{ id: string }>('/v1/reservas', { metodo: 'POST', clave: clave.current, cuerpo: { zona_id: elegida.id, cantidad } });
      clave.current = null;
      router.replace({ pathname: '/reserva/[id]', params: { id: r.id } });
    } catch (e) {
      setFallo(mensajeDeError(e));
      clave.current = null; // un 409 queda asociado a la clave: el próximo intento usa otra
      void recargar(true);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ScrollView style={s.pantalla} contentContainerStyle={s.contenido} refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => void recargar(true)} />}>
      <Stack.Screen options={{ title: datos.nombre }} />
      <Text style={s.titulo}>{datos.nombre}</Text>
      <Text style={s.suave}>{fecha(datos.fecha)} · {datos.recinto}</Text>
      <Text style={s.suave}>Máximo {datos.limite_por_cuenta} entradas por cuenta · Reembolsable hasta {fecha(datos.reembolsable_hasta)}</Text>

      {datos.estado_venta !== 'en_venta' ? <Aviso texto="Este evento no está a la venta en este momento." tipo="alerta" /> : null}

      <Text style={[s.subtitulo, { marginTop: 8 }]}>Elige una zona</Text>
      {datos.zonas.map((z) => {
        const sel = z.id === zona;
        const agotada = z.disponibles <= 0 || !z.fase_vigente;
        return (
          <Pressable key={z.id} disabled={agotada} onPress={() => { setZona(z.id); setCantidad(1); }} accessibilityRole="radio" accessibilityState={{ selected: sel, disabled: agotada }}>
            <Tarjeta estilo={{ borderColor: sel ? color.primario : color.borde, borderWidth: sel ? 2 : 1, opacity: agotada ? 0.5 : 1 }}>
              <View style={s.fila}>
                <Text style={s.subtitulo}>{z.nombre}</Text>
                <Text style={s.texto}>{z.fase_vigente ? pesos(z.fase_vigente.precio_centesimos) : '—'}</Text>
              </View>
              <View style={s.fila}>
                <Text style={s.suave}>{z.fase_vigente ? `Fase ${z.fase_vigente.fase}` : 'Sin fase vigente'}</Text>
                <Text style={[s.suave, z.disponibles <= 50 && { color: color.alerta, fontWeight: '700' }]}>
                  {z.disponibles > 0 ? `Quedan ${z.disponibles}` : 'Agotada'}
                </Text>
              </View>
            </Tarjeta>
          </Pressable>
        );
      })}

      {elegida && elegida.fase_vigente ? (
        <Tarjeta>
          <View style={s.fila}>
            <Text style={s.subtitulo}>Cantidad</Text>
            <View style={[s.fila, { gap: 16 }]}>
              <Boton texto="−" variante="secundario" onPress={() => setCantidad((c) => Math.max(1, c - 1))} deshabilitado={cantidad <= 1} estilo={{ minWidth: 48 }} />
              <Text style={s.titulo}>{cantidad}</Text>
              <Boton texto="+" variante="secundario" onPress={() => setCantidad((c) => Math.min(maximo, c + 1))} deshabilitado={cantidad >= maximo} estilo={{ minWidth: 48 }} />
            </View>
          </View>
          <View style={s.fila}>
            <Text style={s.suave}>Total estimado</Text>
            <Text style={s.subtitulo}>{pesos(elegida.fase_vigente.precio_centesimos * cantidad)}</Text>
          </View>
          <Text style={s.suave}>El precio final lo confirma el servidor al reservar y queda congelado 10 minutos.</Text>
        </Tarjeta>
      ) : null}

      {fallo ? <Aviso texto={fallo} tipo="error" /> : null}
      <Boton texto="Reservar" onPress={reservar} cargando={enviando} deshabilitado={!elegida || datos.estado_venta !== 'en_venta'} />
    </ScrollView>
  );
}
