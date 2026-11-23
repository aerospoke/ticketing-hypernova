import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cargarBilletera, type Entrada } from '../../lib/billetera';
import { useConsulta, useSesion } from '../../lib/usar';
import { Aviso, Cargando, ErrorVista, Insignia, s, TapaSuperior, Vacio } from '../../ui/componentes';
import { fotoDe, Portada } from '../../ui/portada';
import { color, diaMes, espacio, fecha, radio, sombra } from '../../ui/tema';

const ESTADO_ENTRADA: Record<Entrada['estado'], [string, string]> = {
  pagada: ['Lista para entrar', color.exito],
  transferida: ['Recibida', color.info],
  usada: ['Usada', '#6b6580'],
  reembolsada: ['Reembolsada', color.alerta],
  anulada: ['Anulada', color.error],
};

export default function Billetera() {
  const { sesion } = useSesion();
  const arriba = useSafeAreaInsets().top;
  const usuario = sesion?.usuario.id ?? '';
  const { datos, error, cargando, refrescando, recargar } = useConsulta(() => cargarBilletera(usuario), [usuario]);
  useFocusEffect(useCallback(() => void recargar(true), [recargar]));

  if (cargando && !datos) return <Cargando texto="Cargando tus entradas…" />;
  if (error && !datos) return <ErrorVista error={error} reintentar={() => void recargar()} />;

  const entradas = datos?.entradas ?? [];
  const vigentes = entradas.filter((x) => x.estado === 'pagada' || x.estado === 'transferida').length;
  return (
    <View style={s.pantalla}>
    <FlatList
      style={s.pantalla}
      contentContainerStyle={[s.contenido, { paddingTop: arriba + espacio.m, gap: espacio.l }, entradas.length === 0 && { flex: 1 }]}
      data={entradas}
      keyExtractor={(e) => e.id}
      initialNumToRender={6}
      windowSize={7}
      refreshControl={<RefreshControl refreshing={refrescando} tintColor={color.primario} colors={[color.primario]} onRefresh={() => void recargar(true)} />}
      ListHeaderComponent={
        <View style={{ gap: espacio.m }}>
          <View>
            <Text style={e.encabezado}>Mis entradas</Text>
            <Text style={s.suave}>{vigentes > 0 ? `${vigentes} lista(s) para usar · toca una para ver su código` : 'Aquí aparecen las entradas que compres o recibas.'}</Text>
          </View>
          {datos?.offline ? (
            <Aviso tipo="alerta" texto={`✈️ Sin conexión: mostrando tus entradas guardadas${datos.guardada ? ` (${fecha(new Date(datos.guardada).toISOString())})` : ''}. Los códigos funcionan igual.`} />
          ) : null}
        </View>
      }
      ListEmptyComponent={<Vacio titulo="Todavía no tienes entradas" detalle="Cuando compres o te transfieran una, aparecerá aquí." />}
      renderItem={({ item }) => <Boleto entrada={item} />}
    />
    <TapaSuperior alto={arriba} />
    </View>
  );
}

function Boleto({ entrada }: { entrada: Entrada }) {
  const [texto, tono] = ESTADO_ENTRADA[entrada.estado];
  const vigente = entrada.estado === 'pagada' || entrada.estado === 'transferida';
  const { dia, mes } = diaMes(entrada.fecha);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Entrada para ${entrada.evento}, ${texto}`}
      onPress={() => router.push({ pathname: '/entrada/[id]', params: { id: entrada.id, evento: entrada.evento, evento_id: entrada.evento_id } })}
      style={({ pressed }) => [e.boleto, { opacity: vigente ? 1 : 0.6, transform: [{ scale: pressed ? 0.985 : 1 }] }]}
    >
      <Portada foto={fotoDe(entrada.evento_id)} alto={150} hasta={0.7} estilo={e.foto}>
        <View style={e.calendario}>
          <Text style={e.mes}>{mes}</Text>
          <Text style={e.dia}>{dia}</Text>
        </View>
      </Portada>
      {/* Corte del boleto: dos muescas del color del fondo y una línea punteada. */}
      <View style={e.corte}>
        <View style={[e.muesca, { top: -12 }]} />
        <View style={e.punteada}>
          {Array.from({ length: 9 }, (_, i) => <View key={i} style={e.guion} />)}
        </View>
        <View style={[e.muesca, { bottom: -12 }]} />
      </View>
      <View style={e.datos}>
        <Text style={e.evento} numberOfLines={2}>{entrada.evento}</Text>
        <Text style={s.suave} numberOfLines={1}>{entrada.recinto}</Text>
        <Text style={e.zona} numberOfLines={1}>Zona {entrada.zona}</Text>
        <View style={{ flex: 1 }} />
        <Insignia texto={texto} tono={tono} />
        {entrada.transferencia_pendiente_id ? <Text style={[s.suave, { color: color.alerta, fontWeight: '700', fontSize: 12 }]}>⏳ Transferencia pendiente</Text> : null}
      </View>
    </Pressable>
  );
}

const e = StyleSheet.create({
  encabezado: { fontSize: 30, fontWeight: '900', color: color.texto, letterSpacing: -1 },
  boleto: { flexDirection: 'row', backgroundColor: color.tarjeta, borderRadius: radio.m, minHeight: 150, ...sombra },
  foto: { width: 112, height: 'auto', borderTopLeftRadius: radio.m, borderBottomLeftRadius: radio.m },
  calendario: { position: 'absolute', left: 12, bottom: 12, width: 46, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', paddingVertical: 4 },
  mes: { fontSize: 10, fontWeight: '800', color: color.primario2, letterSpacing: 1 },
  dia: { fontSize: 19, fontWeight: '900', color: color.texto, marginTop: -2 },
  corte: { width: 0, alignItems: 'center' },
  muesca: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: color.fondo, left: -12 },
  // Guiones hechos con vistas: en Android un borde 'dashed' de un solo lado sale sólido.
  punteada: { position: 'absolute', top: 18, bottom: 18, left: -1, justifyContent: 'space-between' },
  guion: { width: 2, height: 6, borderRadius: 1, backgroundColor: color.borde },
  datos: { flex: 1, padding: 16, paddingLeft: 20, gap: 3 },
  evento: { fontSize: 17, fontWeight: '800', color: color.texto, letterSpacing: -0.3 },
  zona: { fontSize: 14, fontWeight: '700', color: color.primario, marginTop: 2, marginBottom: 8 },
});
