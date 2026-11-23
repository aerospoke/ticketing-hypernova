import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';
import { mensajeDeError } from '../lib/api';
import { Icono, type NombreIcono } from './icono';
import { color, espacio, radio, sombra } from './tema';

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <View style={s.centro}>
      <ActivityIndicator color={color.primario} size="large" />
      <Text style={s.suave}>{texto}</Text>
    </View>
  );
}

export function Vacio({ titulo, detalle, icono = 'boleto' }: { titulo: string; detalle?: string; icono?: NombreIcono }) {
  return (
    <View style={s.centro}>
      <View style={s.vacioIcono}>
        <Icono nombre={icono} tam={56} />
      </View>
      <Text style={[s.titulo, { textAlign: 'center' }]}>{titulo}</Text>
      {detalle ? <Text style={[s.suave, { textAlign: 'center', maxWidth: 280 }]}>{detalle}</Text> : null}
    </View>
  );
}

export function ErrorVista({ error, reintentar }: { error: unknown; reintentar?: () => void }) {
  return (
    <View style={s.centro}>
      <View style={[s.vacioIcono, { backgroundColor: '#fdecea' }]}>
        <Icono nombre="cerrar" tam={48} />
      </View>
      <Text style={s.titulo}>No se pudo cargar</Text>
      <Text style={[s.suave, { textAlign: 'center', maxWidth: 280 }]}>{mensajeDeError(error)}</Text>
      {reintentar ? <Boton texto="Reintentar" onPress={reintentar} variante="secundario" estilo={{ minWidth: 180 }} /> : null}
    </View>
  );
}

export function Aviso({ texto, tipo = 'info' }: { texto: string; tipo?: 'info' | 'error' | 'alerta' }) {
  const fondo = { info: '#e7f6f4', error: '#fdecea', alerta: '#fff4e5' }[tipo];
  const borde = { info: color.info, error: color.error, alerta: color.acento }[tipo];
  return (
    <View style={[s.aviso, { backgroundColor: fondo, borderLeftColor: borde }]}>
      <Text style={[s.texto, { fontSize: 14, lineHeight: 20 }]}>{texto}</Text>
    </View>
  );
}

export function Boton({
  texto, onPress, variante = 'primario', cargando = false, deshabilitado = false, estilo, icono,
}: {
  texto: string;
  onPress: () => void;
  variante?: 'primario' | 'secundario' | 'peligro' | 'claro';
  cargando?: boolean;
  deshabilitado?: boolean;
  estilo?: ViewStyle;
  icono?: NombreIcono;
}) {
  const inactivo = cargando || deshabilitado;
  const fondo = { primario: color.primario, peligro: color.error, secundario: color.tarjeta, claro: 'rgba(255,255,255,0.16)' }[variante];
  const letra = variante === 'secundario' ? color.texto : color.primarioTexto;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactivo, busy: cargando }}
      onPress={onPress}
      disabled={inactivo}
      style={({ pressed }) => [
        s.boton,
        { backgroundColor: fondo, opacity: inactivo ? 0.45 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        variante === 'primario' && !inactivo && s.botonSombra,
        variante === 'secundario' && s.botonBorde,
        estilo,
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={letra} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icono ? <Icono nombre={icono} tam={20} tinte={variante === 'secundario' ? undefined : '#fff'} /> : null}
          <Text style={[s.botonTexto, { color: letra }]}>{texto}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Campo(props: TextInputProps & { etiqueta: string }) {
  const { etiqueta, ...resto } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.etiqueta}>{etiqueta}</Text>
      <TextInput placeholderTextColor="#a59fb5" style={s.campo} {...resto} />
    </View>
  );
}

export function Tarjeta({ children, estilo }: { children: ReactNode; estilo?: ViewStyle }) {
  return <View style={[s.tarjeta, estilo]}>{children}</View>;
}

/** Pastilla de estado: fondo tenue del color y texto fuerte. `solida` para ponerla sobre fotos. */
export function Insignia({ texto, tono, solida = false }: { texto: string; tono: string; solida?: boolean }) {
  return (
    <View style={[s.insignia, { backgroundColor: solida ? tono : `${tono}1f` }]}>
      <View style={[s.punto, { backgroundColor: solida ? '#fff' : tono }]} />
      <Text style={[s.insigniaTexto, { color: solida ? '#fff' : tono }]}>{texto}</Text>
    </View>
  );
}

/** Título de sección con una línea opcional de apoyo. */
export function Seccion({ titulo, detalle }: { titulo: string; detalle?: string }) {
  return (
    <View style={{ marginTop: espacio.m, gap: 2 }}>
      <Text style={s.seccion}>{titulo}</Text>
      {detalle ? <Text style={s.suave}>{detalle}</Text> : null}
    </View>
  );
}

export const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: color.fondo },
  contenido: { padding: espacio.l, gap: espacio.m, paddingBottom: 40 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espacio.xl, gap: espacio.m },
  titulo: { fontSize: 22, fontWeight: '800', color: color.texto, letterSpacing: -0.4 },
  seccion: { fontSize: 19, fontWeight: '800', color: color.texto, letterSpacing: -0.3 },
  subtitulo: { fontSize: 16, fontWeight: '700', color: color.texto },
  texto: { fontSize: 15, color: color.texto },
  suave: { fontSize: 14, color: color.suave, lineHeight: 20 },
  etiqueta: { fontSize: 13, fontWeight: '700', color: color.suave },
  campo: { backgroundColor: color.fondo, borderWidth: 1.5, borderColor: color.borde, borderRadius: radio.s, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: color.texto },
  boton: { borderRadius: radio.m, paddingVertical: 15, paddingHorizontal: espacio.l, alignItems: 'center', justifyContent: 'center', minHeight: 54 },
  botonSombra: { shadowColor: color.primario, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  botonBorde: { borderWidth: 1.5, borderColor: color.borde },
  botonTexto: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
  tarjeta: { backgroundColor: color.tarjeta, borderRadius: radio.m, padding: espacio.l, gap: espacio.s, ...sombra },
  aviso: { borderRadius: radio.s, borderLeftWidth: 4, paddingVertical: 12, paddingHorizontal: 14 },
  insignia: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  punto: { width: 6, height: 6, borderRadius: 3 },
  insigniaTexto: { fontWeight: '800', fontSize: 12, letterSpacing: 0.2 },
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: espacio.s },
  vacioIcono: { width: 104, height: 104, borderRadius: 52, backgroundColor: color.primarioSuave, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
});

/** Franja del color de fondo detrás de la hora y la batería: al hacer scroll, el contenido no se mezcla con ellas. */
export function TapaSuperior({ alto, tono = color.fondo }: { alto: number; tono?: string }) {
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: alto, backgroundColor: tono, opacity: 0.96 }} />;
}
