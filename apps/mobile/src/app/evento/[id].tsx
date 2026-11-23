import { randomUUID } from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, mensajeDeError } from '../../lib/api';
import { useConsulta } from '../../lib/usar';
import { Aviso, Boton, Cargando, ErrorVista, Insignia, s, Seccion } from '../../ui/componentes';
import { fotoDe, Portada } from '../../ui/portada';
import { color, espacio, fecha, pesos, radio, sombra } from '../../ui/tema';
import { useBarraClara } from '../../ui/barra';

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

const FASE: Record<string, string> = { preventa: 'Preventa', general: 'General', taquilla: 'Taquilla' };

export default function Evento() {
  useBarraClara();
  const { id } = useLocalSearchParams<{ id: string }>();
  const abajo = useSafeAreaInsets().bottom;
  const { datos, error, cargando, refrescando, recargar } = useConsulta(() => api<Detalle>(`/v1/eventos/${id}`), [id]);
  const [zona, setZona] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  // Una clave por intención de compra: el doble toque o el reintento reusan la misma.
  const clave = useRef<string | null>(null);

  const encabezado = <Stack.Screen options={{ title: '', headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerTintColor: '#fff', headerShadowVisible: false }} />;
  if (cargando && !datos) return <>{encabezado}<Cargando /></>;
  if (error || !datos) return <>{encabezado}<ErrorVista error={error} reintentar={() => void recargar()} /></>;

  const elegida = datos.zonas.find((z) => z.id === zona);
  const maximo = Math.min(datos.limite_por_cuenta, elegida?.disponibles ?? 0, 10);
  const enVenta = datos.estado_venta === 'en_venta';

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
    <View style={s.pantalla}>
      {encabezado}
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} refreshControl={<RefreshControl refreshing={refrescando} tintColor="#fff" onRefresh={() => void recargar(true)} />}>
        <Portada foto={fotoDe(datos.id)} alto={330} hasta={0.95}>
          <View style={e.heroTexto}>
            {!enVenta ? <Insignia texto="Fuera de venta" tono={color.acento} solida /> : null}
            <Text style={e.titulo}>{datos.nombre}</Text>
            <Text style={e.meta}>📅  {fecha(datos.fecha)}</Text>
            <Text style={e.meta}>📍  {datos.recinto}</Text>
          </View>
        </Portada>

        <View style={[s.contenido, { marginTop: -22 }]}>
          <View style={e.datos}>
            <Dato valor={`${datos.limite_por_cuenta}`} etiqueta="máx. por cuenta" />
            <View style={e.separador} />
            <Dato valor={new Date(datos.reembolsable_hasta).toLocaleDateString('es-PA', { day: 'numeric', month: 'short' })} etiqueta="reembolsable hasta" />
            <View style={e.separador} />
            <Dato valor={`${datos.zonas.length}`} etiqueta={datos.zonas.length === 1 ? 'zona' : 'zonas'} />
          </View>

          {!enVenta ? <Aviso texto="Este evento no está a la venta en este momento." tipo="alerta" /> : null}

          <Seccion titulo="Elige tu zona" detalle="El precio es el de la fase vigente y queda congelado al reservar." />
          {datos.zonas.map((z) => {
            const sel = z.id === zona;
            const agotada = z.disponibles <= 0 || !z.fase_vigente;
            const ocupado = z.aforo > 0 ? 1 - z.disponibles / z.aforo : 1;
            const pocas = z.disponibles > 0 && z.disponibles <= 50;
            return (
              <Pressable
                key={z.id}
                disabled={agotada}
                onPress={() => { setZona(z.id); setCantidad(1); }}
                accessibilityRole="radio"
                accessibilityState={{ selected: sel, disabled: agotada }}
                style={[e.zona, sel && e.zonaSel, agotada && { opacity: 0.5 }]}
              >
                <View style={s.fila}>
                  <View style={[e.radio, sel && e.radioSel]}>{sel ? <View style={e.radioPunto} /> : null}</View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.subtitulo}>{z.nombre}</Text>
                    {z.fase_vigente ? <Insignia texto={`Fase ${(FASE[z.fase_vigente.fase] ?? z.fase_vigente.fase).toLowerCase()}`} tono={color.primario} /> : <Text style={s.suave}>Sin fase vigente</Text>}
                  </View>
                  <Text style={e.precio}>{z.fase_vigente ? pesos(z.fase_vigente.precio_centesimos) : '—'}</Text>
                </View>
                <View style={e.barra}>
                  <View style={[e.barraLlena, { width: `${Math.round(ocupado * 100)}%`, backgroundColor: pocas || agotada ? color.acento : color.primario }]} />
                </View>
                <Text style={[s.suave, { fontSize: 13 }, pocas && { color: color.alerta, fontWeight: '800' }]}>
                  {z.disponibles > 0 ? `${pocas ? '¡Últimas! ' : ''}Quedan ${z.disponibles.toLocaleString('es-PA')} de ${z.aforo.toLocaleString('es-PA')}` : 'Agotada'}
                </Text>
              </Pressable>
            );
          })}
          {fallo ? <Aviso texto={fallo} tipo="error" /> : null}
        </View>
      </ScrollView>

      <View style={[e.barraCompra, { paddingBottom: abajo + 12 }]}>
        {elegida && elegida.fase_vigente ? (
          <View style={e.cantidad}>
            <Paso texto="−" onPress={() => setCantidad((c) => Math.max(1, c - 1))} deshabilitado={cantidad <= 1} />
            <Text style={e.numero}>{cantidad}</Text>
            <Paso texto="+" onPress={() => setCantidad((c) => Math.min(maximo, c + 1))} deshabilitado={cantidad >= maximo} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={s.suave} numberOfLines={1}>{elegida ? 'Total' : 'Elige una zona'}</Text>
          <Text style={e.total} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{elegida?.fase_vigente ? pesos(elegida.fase_vigente.precio_centesimos * cantidad) : '—'}</Text>
        </View>
        <Boton texto="Reservar" onPress={reservar} cargando={enviando} deshabilitado={!elegida || !enVenta} estilo={{ paddingHorizontal: 22 }} />
      </View>
    </View>
  );
}

function Dato({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 18, fontWeight: '900', color: color.texto }}>{valor}</Text>
      <Text style={{ fontSize: 12, color: color.suave, textAlign: 'center' }}>{etiqueta}</Text>
    </View>
  );
}

function Paso({ texto, onPress, deshabilitado }: { texto: string; onPress: () => void; deshabilitado: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={texto === '+' ? 'Una más' : 'Una menos'} onPress={onPress} disabled={deshabilitado} style={[e.paso, deshabilitado && { opacity: 0.35 }]}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: color.primario }}>{texto}</Text>
    </Pressable>
  );
}

const e = StyleSheet.create({
  heroTexto: { position: 'absolute', left: espacio.l, right: espacio.l, bottom: 40, gap: 4 },
  titulo: { color: '#fff', fontSize: 32, lineHeight: 36, fontWeight: '900', letterSpacing: -1, marginBottom: 6 },
  meta: { color: 'rgba(255,255,255,0.88)', fontSize: 15 },
  datos: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.tarjeta, borderRadius: radio.m, paddingVertical: 16, ...sombra },
  separador: { width: 1, height: 32, backgroundColor: color.borde },
  zona: { backgroundColor: color.tarjeta, borderRadius: radio.m, padding: espacio.l, gap: 12, borderWidth: 2, borderColor: 'transparent', ...sombra },
  zonaSel: { borderColor: color.primario, backgroundColor: '#fcf9ff' },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: color.borde, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  radioSel: { borderColor: color.primario },
  radioPunto: { width: 12, height: 12, borderRadius: 6, backgroundColor: color.primario },
  precio: { fontSize: 18, fontWeight: '900', color: color.texto },
  barra: { height: 6, borderRadius: 3, backgroundColor: color.fondo, overflow: 'hidden' },
  barraLlena: { height: 6, borderRadius: 3 },
  barraCompra: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: color.tarjeta, paddingHorizontal: espacio.l, paddingTop: 14, borderTopLeftRadius: radio.l, borderTopRightRadius: radio.l, shadowColor: '#120d1f', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  cantidad: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: color.fondo, borderRadius: 999, padding: 4 },
  paso: { width: 34, height: 34, borderRadius: 17, backgroundColor: color.tarjeta, alignItems: 'center', justifyContent: 'center' },
  numero: { fontSize: 18, fontWeight: '900', color: color.texto, minWidth: 20, textAlign: 'center' },
  total: { fontSize: 20, fontWeight: '900', color: color.texto },
});
