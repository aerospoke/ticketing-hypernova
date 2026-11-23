import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';
import { mensajeDeError } from '../lib/api';
import { color, espacio } from './tema';

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <View style={s.centro}>
      <ActivityIndicator color={color.primario} size="large" />
      <Text style={s.suave}>{texto}</Text>
    </View>
  );
}

export function Vacio({ titulo, detalle }: { titulo: string; detalle?: string }) {
  return (
    <View style={s.centro}>
      <Text style={s.titulo}>{titulo}</Text>
      {detalle ? <Text style={[s.suave, { textAlign: 'center' }]}>{detalle}</Text> : null}
    </View>
  );
}

export function ErrorVista({ error, reintentar }: { error: unknown; reintentar?: () => void }) {
  return (
    <View style={s.centro}>
      <Text style={[s.titulo, { color: color.error }]}>No se pudo cargar</Text>
      <Text style={[s.suave, { textAlign: 'center' }]}>{mensajeDeError(error)}</Text>
      {reintentar ? <Boton texto="Reintentar" onPress={reintentar} variante="secundario" /> : null}
    </View>
  );
}

export function Aviso({ texto, tipo = 'info' }: { texto: string; tipo?: 'info' | 'error' | 'alerta' }) {
  const fondo = { info: '#e6f7f5', error: '#fdecea', alerta: '#fff4e5' }[tipo];
  const borde = { info: color.info, error: color.error, alerta: color.alerta }[tipo];
  return (
    <View style={[s.aviso, { backgroundColor: fondo, borderColor: borde }]}>
      <Text style={s.texto}>{texto}</Text>
    </View>
  );
}

export function Boton({
  texto, onPress, variante = 'primario', cargando = false, deshabilitado = false, estilo,
}: {
  texto: string;
  onPress: () => void;
  variante?: 'primario' | 'secundario' | 'peligro';
  cargando?: boolean;
  deshabilitado?: boolean;
  estilo?: ViewStyle;
}) {
  const inactivo = cargando || deshabilitado;
  const fondo = variante === 'primario' ? color.primario : variante === 'peligro' ? color.error : color.tarjeta;
  const letra = variante === 'secundario' ? color.texto : color.primarioTexto;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactivo, busy: cargando }}
      onPress={onPress}
      disabled={inactivo}
      style={({ pressed }) => [s.boton, { backgroundColor: fondo, opacity: inactivo ? 0.5 : pressed ? 0.8 : 1 }, variante === 'secundario' && s.botonBorde, estilo]}
    >
      {cargando ? <ActivityIndicator color={letra} /> : <Text style={[s.botonTexto, { color: letra }]}>{texto}</Text>}
    </Pressable>
  );
}

export function Campo(props: TextInputProps & { etiqueta: string }) {
  const { etiqueta, ...resto } = props;
  return (
    <View style={{ gap: espacio.xs }}>
      <Text style={s.etiqueta}>{etiqueta}</Text>
      <TextInput placeholderTextColor={color.suave} style={s.campo} {...resto} />
    </View>
  );
}

export function Tarjeta({ children, estilo }: { children: ReactNode; estilo?: ViewStyle }) {
  return <View style={[s.tarjeta, estilo]}>{children}</View>;
}

export function Insignia({ texto, tono }: { texto: string; tono: string }) {
  return (
    <View style={[s.insignia, { backgroundColor: tono }]}>
      <Text style={s.insigniaTexto}>{texto}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: color.fondo },
  contenido: { padding: espacio.l, gap: espacio.m },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espacio.xl, gap: espacio.m },
  titulo: { fontSize: 20, fontWeight: '700', color: color.texto },
  subtitulo: { fontSize: 16, fontWeight: '600', color: color.texto },
  texto: { fontSize: 15, color: color.texto },
  suave: { fontSize: 14, color: color.suave },
  etiqueta: { fontSize: 13, fontWeight: '600', color: color.suave },
  campo: { backgroundColor: color.tarjeta, borderWidth: 1, borderColor: color.borde, borderRadius: 12, padding: espacio.m, fontSize: 16, color: color.texto },
  boton: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: espacio.l, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  botonBorde: { borderWidth: 1, borderColor: color.borde },
  botonTexto: { fontSize: 16, fontWeight: '700' },
  tarjeta: { backgroundColor: color.tarjeta, borderRadius: 14, padding: espacio.l, borderWidth: 1, borderColor: color.borde, gap: espacio.s },
  aviso: { borderRadius: 12, borderWidth: 1, padding: espacio.m },
  insignia: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  insigniaTexto: { color: '#fff', fontWeight: '700', fontSize: 12 },
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: espacio.s },
});
