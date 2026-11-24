/**
 * Resumen al terminar el turno: cifras, escaneos y lo que falta sincronizar. Los escaneos
 * siguen en SQLite después de cerrar el turno; si quedaron pendientes, se pueden subir desde
 * aquí cuando vuelva la red.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cerrarSesion, ErrorApi, mensajeDeError } from '../../lib/api';
import { resumenTurno, sincronizar, ultimosEscaneos } from '../../lib/escaner';
import { Aviso, Boton, s } from '../../ui/componentes';
import { MOTIVO } from '../../ui/escaner-textos';
import { Icono } from '../../ui/icono';
import { color, espacio, radio, sombra } from '../../ui/tema';
import { useBarraClara } from '../../ui/barra';
import { AvisoSinRed } from '../../ui/sin-red';

export default function ResumenTurno() {
  useBarraClara();
  const { turno, evento, puerta } = useLocalSearchParams<{ turno: string; evento?: string; puerta?: string }>();
  const { top, bottom } = useSafeAreaInsets();
  const [version, setVersion] = useState(0); // fuerza releer SQLite tras sincronizar
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'info' | 'error'; texto: string } | null>(null);
  const [avisoSinRed, setAvisoSinRed] = useState(false);

  const escaneos = ultimosEscaneos(turno, 5000);
  const r = resumenTurno(turno);
  const pendientes = escaneos.filter((e) => !e.sincronizado).length;
  const dobles = escaneos.filter((e) => e.resultado_servidor === 'duplicado_offline').length;
  void version;

  async function subir() {
    setSincronizando(true);
    setAviso(null);
    try {
      const x = await sincronizar();
      setAviso({ tipo: 'info', texto: x.duplicados > 0 ? `Sincronizado. ${x.duplicados} doble(s) ingreso(s) reportado(s) al portal.` : 'Sincronizado.' });
    } catch (e) {
      if (e instanceof ErrorApi && e.sinConexion) setAvisoSinRed(true);
      else setAviso({ tipo: 'error', texto: mensajeDeError(e) });
    } finally {
      setSincronizando(false);
      setVersion((v) => v + 1);
    }
  }

  return (
    <>
    <AvisoSinRed visible={avisoSinRed} pendientes={pendientes} cerrar={() => setAvisoSinRed(false)} enTurno={false} />
    <FlatList
      style={s.pantalla}
      contentContainerStyle={{ paddingBottom: bottom + 32 }}
      data={escaneos}
      keyExtractor={(e) => e.client_scan_id}
      initialNumToRender={15}
      ListHeaderComponent={
        <View>
          <View style={[e.cabecera, { paddingTop: top + espacio.xl }]}>
            <View style={e.icono}>
              <Icono nombre="listo" tam={44} />
            </View>
            <Text style={e.titulo}>Turno terminado</Text>
            <Text style={e.subtitulo}>{puerta} · {evento}</Text>
          </View>
          <View style={[s.contenido, { marginTop: -36 }]}>
            <View style={e.cifras}>
              <Cifra valor={r.validos ?? 0} etiqueta="Válidas" tono={color.exito} />
              <Cifra valor={r.rechazos ?? 0} etiqueta="Rechazos" tono={color.error} />
              <Cifra valor={dobles} etiqueta="Doble ingreso" tono={dobles > 0 ? color.acento : color.suave} />
              <Cifra valor={pendientes} etiqueta="Sin subir" tono={pendientes > 0 ? color.alerta : color.suave} />
            </View>
            {pendientes > 0 ? (
              <Aviso tipo="alerta" texto={`${pendientes} escaneo(s) quedaron guardados en este teléfono sin subir. No se pierden: toca Sincronizar cuando tengas red.`} />
            ) : (
              <Aviso tipo="info" texto="Todo sincronizado. Los ingresos ya están en el portal." />
            )}
            {aviso ? <Aviso tipo={aviso.tipo} texto={aviso.texto} /> : null}
            {pendientes > 0 ? <Boton texto="Sincronizar" onPress={() => void subir()} cargando={sincronizando} /> : null}
            <Boton texto="Iniciar otro turno" variante={pendientes > 0 ? 'secundario' : 'primario'} onPress={() => router.replace('/escaner')} />
            <Boton texto="Cerrar sesión" variante="secundario" onPress={async () => { await cerrarSesion(); router.replace('/login'); }} />
            <Text style={[s.seccion, { marginTop: espacio.m }]}>Escaneos del turno</Text>
            {escaneos.length === 0 ? <Text style={s.suave}>No escaneaste ninguna entrada en este turno.</Text> : null}
          </View>
        </View>
      }
      renderItem={({ item }) => {
        const ok = item.resultado === 'valido';
        const doble = item.resultado_servidor === 'duplicado_offline';
        const tono = doble ? color.acento : ok ? color.exito : color.error;
        return (
          <View style={e.fila}>
            <View style={[e.marca, { backgroundColor: tono }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.subtitulo}>Entrada #{item.entrada_id ?? '?'}</Text>
              <Text style={[s.suave, { fontSize: 13 }]}>
                {new Date(item.escaneado_en).toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                {' · '}
                {item.sincronizado ? (doble ? 'doble ingreso detectado' : 'sincronizado') : 'sin subir'}
              </Text>
            </View>
            <Text style={[e.resultado, { color: tono }]}>{doble ? 'DOBLE' : ok ? 'VÁLIDA' : (MOTIVO[item.motivo ?? ''] ?? 'rechazada').toUpperCase()}</Text>
          </View>
        );
      }}
    />
    </>
  );
}

function Cifra({ valor, etiqueta, tono }: { valor: number; etiqueta: string; tono: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 24, fontWeight: '900', color: tono }}>{valor}</Text>
      <Text style={{ fontSize: 11, fontWeight: '700', color: color.suave, textAlign: 'center' }}>{etiqueta}</Text>
    </View>
  );
}

const e = StyleSheet.create({
  cabecera: { backgroundColor: color.noche, alignItems: 'center', paddingHorizontal: espacio.l, paddingBottom: 60, gap: 6 },
  icono: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  titulo: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -0.6 },
  subtitulo: { color: 'rgba(255,255,255,0.75)', fontSize: 15, textAlign: 'center' },
  cifras: { flexDirection: 'row', backgroundColor: color.tarjeta, borderRadius: radio.m, paddingVertical: 16, ...sombra },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: color.tarjeta, marginHorizontal: espacio.l, marginBottom: 8, borderRadius: radio.s, padding: 14 },
  marca: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  resultado: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5, maxWidth: 120, textAlign: 'right' },
});
