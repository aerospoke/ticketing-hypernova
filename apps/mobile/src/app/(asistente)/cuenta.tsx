import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, cerrarSesion, mensajeDeError } from '../../lib/api';
import { useConsulta, useSesion } from '../../lib/usar';
import { Aviso, Boton, Cargando, ErrorVista, Insignia, s, Seccion, TapaSuperior, Tarjeta } from '../../ui/componentes';
import { Icono } from '../../ui/icono';
import { Degradado } from '../../ui/portada';
import { color, espacio, fecha, pesos, radio } from '../../ui/tema';
import { useBarraClara } from '../../ui/barra';

interface Compra {
  id: string;
  evento: string;
  zona: string;
  cantidad: number;
  monto_centesimos: number;
  reembolsado_centesimos: number;
  estado: 'pagada' | 'reembolsada' | 'reembolso_automatico';
  pagada_en: string;
  entradas: { id: string; estado: string }[];
}
interface Transferencia {
  id: string;
  entrada_id: string;
  estado: 'pendiente' | 'aceptada' | 'cancelada' | 'rechazada';
  direccion: 'enviada' | 'recibida';
  de_email: string;
  a_email: string;
  evento: string;
}

const ESTADO_COMPRA = { pagada: ['Pagada', color.exito], reembolsada: ['Reembolsada', color.alerta], reembolso_automatico: ['Devuelta', color.alerta] } as const;
const ESTADO_TRANSF = {
  pendiente: ['Pendiente', color.alerta],
  aceptada: ['Aceptada', color.exito],
  cancelada: ['Cancelada', '#6b6580'],
  rechazada: ['Rechazada', color.error],
} as const;
const ESTADO_ENTRADA: Record<string, string> = { pagada: 'pagada', transferida: 'transferida', usada: 'usada', reembolsada: 'reembolsada', anulada: 'anulada' };

export default function Cuenta() {
  useBarraClara();
  const { sesion } = useSesion();
  const arriba = useSafeAreaInsets().top;
  const { datos, error, cargando, refrescando, recargar } = useConsulta(async () => {
    const [compras, transferencias] = await Promise.all([
      api<{ items: Compra[] }>('/v1/me/compras'),
      api<Transferencia[]>('/v1/me/transferencias'),
    ]);
    return { compras: compras.items, transferencias };
  });
  const [fallo, setFallo] = useState<string | null>(null);

  async function resolver(t: Transferencia, accion: 'aceptar' | 'rechazar' | 'cancelar') {
    setFallo(null);
    try {
      await api(`/v1/transferencias/${t.id}/${accion}`, { metodo: 'POST' });
      void recargar(true);
    } catch (e) {
      setFallo(mensajeDeError(e));
    }
  }

  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <ErrorVista error={error} reintentar={() => void recargar()} />;

  const nombre = sesion?.usuario.nombre ?? '';
  const iniciales = nombre.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  const compras = datos?.compras ?? [];
  const totalEntradas = compras.reduce((n, c) => n + c.cantidad, 0);
  const pendientes = (datos?.transferencias ?? []).filter((t) => t.estado === 'pendiente').length;

  return (
    <View style={s.pantalla}>
    <ScrollView style={s.pantalla} contentContainerStyle={{ paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refrescando} tintColor="#fff" onRefresh={() => void recargar(true)} />}>
      <View style={[e.cabecera, { paddingTop: arriba + espacio.l }]}>
        <Degradado desde={0} hasta={0.55} tono={color.primario2} inicio="0%" />
        <View style={e.avatar}>
          <Text style={e.avatarTexto}>{iniciales || '?'}</Text>
        </View>
        <Text style={e.nombre}>{nombre}</Text>
        <Text style={e.email}>{sesion?.usuario.email}</Text>
        <View style={e.cifras}>
          <Cifra valor={compras.length} etiqueta="compras" />
          <Cifra valor={totalEntradas} etiqueta="entradas" />
          <Cifra valor={pendientes} etiqueta="por resolver" />
        </View>
      </View>

      <View style={s.contenido}>
        <Seccion titulo="Transferencias" />
        {fallo ? <Aviso tipo="error" texto={fallo} /> : null}
        {datos?.transferencias.length === 0 ? <Tarjeta><Text style={s.suave}>No tienes transferencias. Puedes enviar una entrada desde su pantalla.</Text></Tarjeta> : null}
        {datos?.transferencias.map((t) => (
          <Tarjeta key={t.id}>
            <View style={s.fila}>
              <Text style={[s.subtitulo, { flex: 1 }]} numberOfLines={1}>{t.evento}</Text>
              <Insignia texto={ESTADO_TRANSF[t.estado][0]} tono={ESTADO_TRANSF[t.estado][1]} />
            </View>
            <Text style={s.suave}>
              {t.direccion === 'recibida' ? `📥  De ${t.de_email}` : `📤  Para ${t.a_email}`} · Entrada #{t.entrada_id}
            </Text>
            {t.estado === 'pendiente' && t.direccion === 'recibida' ? (
              <View style={[s.fila, { gap: 10, marginTop: 4 }]}>
                <Boton texto="Aceptar" onPress={() => void resolver(t, 'aceptar')} estilo={{ flex: 1 }} />
                <Boton texto="Rechazar" variante="secundario" onPress={() => void resolver(t, 'rechazar')} estilo={{ flex: 1 }} />
              </View>
            ) : null}
            {t.estado === 'pendiente' && t.direccion === 'enviada' ? (
              <Boton texto="Cancelar transferencia" variante="secundario" onPress={() => void resolver(t, 'cancelar')} />
            ) : null}
          </Tarjeta>
        ))}

        <Seccion titulo="Historial de compras" />
        {compras.length === 0 ? <Tarjeta><Text style={s.suave}>Todavía no compraste entradas.</Text></Tarjeta> : null}
        {compras.map((c) => (
          <Tarjeta key={c.id}>
            <View style={s.fila}>
              <View style={e.icono}>
                <Icono nombre="boleto" tam={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.subtitulo} numberOfLines={1}>{c.evento}</Text>
                <Text style={s.suave}>{c.zona} · {c.cantidad} entrada(s)</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={{ fontWeight: '900', fontSize: 16, color: color.texto }}>{pesos(c.monto_centesimos)}</Text>
                <Insignia texto={ESTADO_COMPRA[c.estado][0]} tono={ESTADO_COMPRA[c.estado][1]} />
              </View>
            </View>
            <Text style={[s.suave, { fontSize: 13 }]}>{fecha(c.pagada_en)}</Text>
            {c.reembolsado_centesimos > 0 ? <Text style={[s.suave, { color: color.alerta, fontWeight: '700' }]}>Reembolsado: {pesos(c.reembolsado_centesimos)}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {c.entradas.map((en) => (
                <View key={en.id} style={e.chip}>
                  <Text style={e.chipTexto}>#{en.id} · {ESTADO_ENTRADA[en.estado] ?? en.estado}</Text>
                </View>
              ))}
            </View>
          </Tarjeta>
        ))}

        <Boton texto="Cerrar sesión" variante="secundario" onPress={async () => { await cerrarSesion(); router.replace('/login'); }} estilo={{ marginTop: espacio.m }} />
      </View>
    </ScrollView>
    <TapaSuperior alto={arriba} tono={color.primario} />
    </View>
  );
}

function Cifra({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>{valor}</Text>
      <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{etiqueta}</Text>
    </View>
  );
}

const e = StyleSheet.create({
  cabecera: { backgroundColor: color.primario, alignItems: 'center', paddingHorizontal: espacio.l, paddingBottom: 44, overflow: 'hidden' },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 3, borderColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
  avatarTexto: { color: '#fff', fontSize: 30, fontWeight: '900' },
  nombre: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 12, letterSpacing: -0.4 },
  email: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  cifras: { flexDirection: 'row', alignSelf: 'stretch', marginTop: espacio.l, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radio.m, paddingVertical: 12 },
  icono: { width: 44, height: 44, borderRadius: 14, backgroundColor: color.primarioSuave, alignItems: 'center', justifyContent: 'center' },
  chip: { backgroundColor: color.fondo, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipTexto: { fontSize: 12, fontWeight: '700', color: color.suave },
});
