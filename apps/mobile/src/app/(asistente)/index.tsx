import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../lib/api';
import { useConsulta, useSesion } from '../../lib/usar';
import { Cargando, ErrorVista, Insignia, s, TapaSuperior, Vacio } from '../../ui/componentes';
import { Icono } from '../../ui/icono';
import { fotoDe, Portada } from '../../ui/portada';
import { color, diaMes, espacio, pesos, radio, sombra } from '../../ui/tema';

interface EventoCartelera {
  id: string;
  nombre: string;
  recinto: string;
  fecha: string;
  estado_venta: 'proximo' | 'en_venta' | 'finalizado' | 'cancelado';
  precio_desde_centesimos: number | null;
  disponibles: number;
}
interface Pagina {
  items: EventoCartelera[];
  siguiente_cursor: string | null;
}

const ESTADO: Record<EventoCartelera['estado_venta'], [string, string]> = {
  en_venta: ['En venta', color.exito],
  proximo: ['Próximamente', color.info],
  finalizado: ['Finalizado', '#6b6580'],
  cancelado: ['Cancelado', color.error],
};

export default function Cartelera() {
  const { sesion } = useSesion();
  const arriba = useSafeAreaInsets().top;
  const { datos, error, cargando, refrescando, recargar } = useConsulta(() => api<Pagina>('/v1/eventos'));
  const [extra, setExtra] = useState<EventoCartelera[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);

  const siguiente = cursor === undefined ? datos?.siguiente_cursor : cursor;
  const cargarMas = useCallback(async () => {
    if (!siguiente) return;
    const p = await api<Pagina>(`/v1/eventos?cursor=${encodeURIComponent(siguiente)}`).catch(() => null);
    if (p) {
      setExtra((x) => [...x, ...p.items]);
      setCursor(p.siguiente_cursor);
    }
  }, [siguiente]);

  if (cargando && !datos) return <Cargando texto="Cargando cartelera…" />;
  if (error && !datos) return <ErrorVista error={error} reintentar={() => void recargar()} />;

  const eventos = [...(datos?.items ?? []), ...extra];
  const nombre = sesion?.usuario.nombre.split(' ')[0];
  return (
    <View style={s.pantalla}>
    <FlatList
      style={s.pantalla}
      contentContainerStyle={[s.contenido, { paddingTop: arriba + espacio.m, gap: espacio.l }, eventos.length === 0 && { flex: 1 }]}
      data={eventos}
      keyExtractor={(e) => e.id}
      onEndReached={cargarMas}
      onEndReachedThreshold={0.5}
      initialNumToRender={4}
      windowSize={5}
      refreshControl={<RefreshControl refreshing={refrescando} tintColor={color.primario} colors={[color.primario]} onRefresh={() => { setExtra([]); setCursor(undefined); void recargar(true); }} />}
      ListHeaderComponent={
        <View style={{ gap: 2 }}>
          <Text style={s.suave}>Hola{nombre ? `, ${nombre}` : ''} 👋</Text>
          <Text style={e.encabezado}>¿A qué evento{'\n'}vas esta vez?</Text>
        </View>
      }
      ListEmptyComponent={<Vacio icono="estrella" titulo="No hay eventos por ahora" detalle="Desliza hacia abajo para actualizar." />}
      renderItem={({ item }) => <TarjetaEvento evento={item} />}
    />
    <TapaSuperior alto={arriba} />
    </View>
  );
}

function TarjetaEvento({ evento }: { evento: EventoCartelera }) {
  const [texto, tono] = ESTADO[evento.estado_venta];
  const { dia, mes } = diaMes(evento.fecha);
  const pocas = evento.disponibles > 0 && evento.disponibles <= 50 && evento.estado_venta === 'en_venta';
  const apagado = evento.estado_venta === 'finalizado' || evento.estado_venta === 'cancelado';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${evento.nombre}, ${texto}`}
      onPress={() => router.push({ pathname: '/evento/[id]', params: { id: evento.id } })}
      style={({ pressed }) => [e.tarjeta, { opacity: apagado ? 0.7 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }]}
    >
      <Portada foto={fotoDe(evento.id)} alto={200}>
        <View style={e.arriba}>
          <Insignia texto={texto} tono={tono} solida />
          {pocas ? <Insignia texto="🔥 Alta demanda" tono={color.acento} solida /> : null}
        </View>
        <View style={e.abajo}>
          <View style={e.calendario}>
            <Text style={e.mes}>{mes}</Text>
            <Text style={e.dia}>{dia}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={e.nombre} numberOfLines={2}>{evento.nombre}</Text>
            <Text style={e.recinto} numberOfLines={1}>{evento.recinto}</Text>
          </View>
        </View>
      </Portada>
      <View style={e.pie}>
        <View>
          <Text style={e.desde}>Desde</Text>
          <Text style={e.precio}>{evento.precio_desde_centesimos != null ? pesos(evento.precio_desde_centesimos) : '—'}</Text>
        </View>
        <View style={[e.cupo, pocas && { backgroundColor: '#fff4e5' }]}>
          <Icono nombre="boleto" tam={16} />
          <Text style={[e.cupoTexto, pocas && { color: color.alerta }]}>
            {evento.disponibles > 0 ? `${evento.disponibles.toLocaleString('es-PA')} disponibles` : 'Agotado'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const e = StyleSheet.create({
  encabezado: { fontSize: 30, lineHeight: 34, fontWeight: '900', color: color.texto, letterSpacing: -1 },
  tarjeta: { backgroundColor: color.tarjeta, borderRadius: radio.l, overflow: 'hidden', ...sombra },
  arriba: { position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between' },
  abajo: { position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  calendario: { width: 52, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', paddingVertical: 6 },
  mes: { fontSize: 11, fontWeight: '800', color: color.primario2, letterSpacing: 1 },
  dia: { fontSize: 22, fontWeight: '900', color: color.texto, marginTop: -2 },
  nombre: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  recinto: { color: 'rgba(255,255,255,0.82)', fontSize: 14, marginTop: 2 },
  pie: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 },
  desde: { fontSize: 12, color: color.suave, fontWeight: '600' },
  precio: { fontSize: 18, fontWeight: '900', color: color.texto },
  cupo: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.fondo, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  cupoTexto: { fontSize: 13, fontWeight: '700', color: color.suave },
});
