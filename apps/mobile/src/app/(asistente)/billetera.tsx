import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { cargarBilletera, type Entrada } from '../../lib/billetera';
import { useConsulta, useSesion } from '../../lib/usar';
import { Aviso, Cargando, ErrorVista, Insignia, s, Tarjeta, Vacio } from '../../ui/componentes';
import { color, fecha } from '../../ui/tema';

const ESTADO_ENTRADA: Record<Entrada['estado'], [string, string]> = {
  pagada: ['Pagada', color.exito],
  transferida: ['Recibida', color.info],
  usada: ['Usada', color.suave],
  reembolsada: ['Reembolsada', color.alerta],
  anulada: ['Anulada', color.error],
};

export default function Billetera() {
  const { sesion } = useSesion();
  const usuario = sesion?.usuario.id ?? '';
  const { datos, error, cargando, refrescando, recargar } = useConsulta(() => cargarBilletera(usuario), [usuario]);
  useFocusEffect(useCallback(() => void recargar(true), [recargar]));

  if (cargando && !datos) return <Cargando texto="Cargando tus entradas…" />;
  if (error && !datos) return <ErrorVista error={error} reintentar={() => void recargar()} />;

  return (
    <FlatList
      style={s.pantalla}
      contentContainerStyle={[s.contenido, (datos?.entradas.length ?? 0) === 0 && { flex: 1 }]}
      data={datos?.entradas ?? []}
      keyExtractor={(e) => e.id}
      initialNumToRender={8}
      windowSize={7}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => void recargar(true)} />}
      ListHeaderComponent={datos?.offline ? <Aviso tipo="alerta" texto={`Sin conexión: mostrando tus entradas guardadas${datos.guardada ? ` (${fecha(new Date(datos.guardada).toISOString())})` : ''}. Los códigos funcionan igual.`} /> : undefined}
      ListEmptyComponent={<Vacio titulo="Todavía no tienes entradas" detalle="Cuando compres o te transfieran una, aparecerá aquí." />}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/entrada/[id]', params: { id: item.id, evento: item.evento } })}>
          <Tarjeta estilo={{ opacity: item.estado === 'pagada' || item.estado === 'transferida' ? 1 : 0.6 }}>
            <View style={s.fila}>
              <Text style={[s.subtitulo, { flex: 1 }]}>{item.evento}</Text>
              <Insignia texto={ESTADO_ENTRADA[item.estado][0]} tono={ESTADO_ENTRADA[item.estado][1]} />
            </View>
            <Text style={s.suave}>{fecha(item.fecha)} · {item.recinto}</Text>
            <Text style={s.texto}>Zona {item.zona} · Entrada #{item.id}</Text>
            {item.transferencia_pendiente_id ? <Text style={[s.suave, { color: color.alerta }]}>Transferencia pendiente</Text> : null}
          </Tarjeta>
        </Pressable>
      )}
    />
  );
}
