import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { useConsulta } from '../../lib/usar';
import { Cargando, ErrorVista, Insignia, s, Tarjeta, Vacio } from '../../ui/componentes';
import { color, fecha, pesos } from '../../ui/tema';

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
  finalizado: ['Finalizado', color.suave],
  cancelado: ['Cancelado', color.error],
};

export default function Cartelera() {
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
  return (
    <FlatList
      style={s.pantalla}
      contentContainerStyle={[s.contenido, eventos.length === 0 && { flex: 1 }]}
      data={eventos}
      keyExtractor={(e) => e.id}
      onEndReached={cargarMas}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => { setExtra([]); setCursor(undefined); void recargar(true); }} />}
      ListEmptyComponent={<Vacio titulo="No hay eventos por ahora" detalle="Desliza hacia abajo para actualizar." />}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/evento/[id]', params: { id: item.id } })}>
          <Tarjeta>
            <View style={s.fila}>
              <Text style={[s.subtitulo, { flex: 1 }]}>{item.nombre}</Text>
              <Insignia texto={ESTADO[item.estado_venta][0]} tono={ESTADO[item.estado_venta][1]} />
            </View>
            <Text style={s.suave}>{fecha(item.fecha)} · {item.recinto}</Text>
            <View style={s.fila}>
              <Text style={s.texto}>{item.precio_desde_centesimos != null ? `Desde ${pesos(item.precio_desde_centesimos)}` : 'Sin precio vigente'}</Text>
              <Text style={[s.suave, item.disponibles <= 50 && { color: color.alerta, fontWeight: '700' }]}>
                {item.disponibles > 0 ? `${item.disponibles} disponibles` : 'Agotado'}
              </Text>
            </View>
          </Tarjeta>
        </Pressable>
      )}
    />
  );
}
