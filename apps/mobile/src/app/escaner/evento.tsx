/**
 * Detalle de un evento para el staff: su actividad en el evento (lo ya sincronizado), los
 * incidentes sobre sus escaneos, y la elección de puerta para iniciar el turno.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { mensajeDeError } from '../../lib/api';
import { contarPendientes, iniciarTurno, misEventos } from '../../lib/escaner';
import { useConsulta } from '../../lib/usar';
import { Aviso, Boton, Cargando, ErrorVista, s, Seccion } from '../../ui/componentes';
import { fotoDe, Portada } from '../../ui/portada';
import { color, espacio, fecha, radio, sombra } from '../../ui/tema';
import { useBarraClara } from '../../ui/barra';

export default function EventoStaff() {
  useBarraClara();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { datos, error, cargando, refrescando, recargar } = useConsulta(() => misEventos());
  const [puerta, setPuerta] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const encabezado = <Stack.Screen options={{ headerShown: true, title: '', headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerTintColor: '#fff', headerShadowVisible: false }} />;
  const ev = datos?.find((x) => x.id === id);
  if (cargando && !datos) return <>{encabezado}<Cargando /></>;
  if (error && !datos) return <>{encabezado}<ErrorVista error={error} reintentar={() => void recargar()} /></>;
  if (!ev) return <>{encabezado}<ErrorVista error={null} reintentar={() => router.back()} /></>;

  const c = ev.mis_cifras;
  const pendientes = contarPendientes();

  async function abrir() {
    if (!ev || !puerta) return;
    setAbriendo(true);
    setFallo(null);
    try {
      await iniciarTurno(ev, puerta);
      router.replace('/escaner/camara');
    } catch (e) {
      setFallo(mensajeDeError(e));
    } finally {
      setAbriendo(false);
    }
  }

  return (
    <ScrollView style={s.pantalla} contentContainerStyle={{ paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refrescando} tintColor="#fff" onRefresh={() => void recargar(true)} />}>
      {encabezado}
      <Portada foto={fotoDe(ev.id)} alto={260} hasta={0.95}>
        <View style={e.hero}>
          <Text style={e.heroEtiqueta}>TU ACTIVIDAD EN</Text>
          <Text style={e.titulo}>{ev.nombre}</Text>
          <Text style={e.meta}>{fecha(ev.fecha)} · {ev.recinto}</Text>
        </View>
      </Portada>

      <View style={[s.contenido, { marginTop: -24 }]}>
        <View style={e.cifras}>
          <Cifra valor={c.validos} etiqueta="Válidas" tono={color.exito} />
          <Cifra valor={c.rechazos} etiqueta="Rechazos" tono={color.error} />
          <Cifra valor={c.dobles} etiqueta="Doble ingreso" tono={c.dobles > 0 ? color.acento : color.suave} />
        </View>
        <Text style={[s.suave, { textAlign: 'center', fontSize: 13 }]}>
          {c.ultimo_escaneo ? `Tu último escaneo sincronizado: ${fecha(c.ultimo_escaneo)}` : 'Todavía no tienes escaneos sincronizados en este evento.'}
        </Text>

        {c.incidentes_abiertos > 0 ? (
          <Aviso tipo="alerta" texto={`⚠️ ${c.incidentes_abiertos} incidente(s) abierto(s) sobre tus escaneos: una entrada que validaste ya había ingresado por otra puerta. El organizador lo revisa en el portal.`} />
        ) : (
          <Aviso tipo="info" texto="Sin incidentes en tus escaneos de este evento." />
        )}
        {pendientes > 0 ? <Aviso tipo="alerta" texto={`${pendientes} escaneo(s) en este teléfono todavía sin sincronizar: no están en estas cifras.`} /> : null}

        <Seccion titulo="¿En qué puerta vas a estar?" detalle="Al iniciar se descarga la lista de entradas revocadas. Después puedes activar el modo avión." />
        <View style={e.puertas}>
          {ev.puertas.length === 0 ? <Text style={s.suave}>El evento no tiene puertas configuradas.</Text> : null}
          {ev.puertas.map((p) => {
            const sel = puerta === p.id;
            return (
              <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{ selected: sel }} onPress={() => setPuerta(p.id)} style={[e.puerta, sel && e.puertaSel]}>
                <Text style={[e.puertaTexto, sel && { color: '#fff' }]}>🚪  {p.nombre}</Text>
              </Pressable>
            );
          })}
        </View>
        {fallo ? <Aviso tipo="error" texto={fallo} /> : null}
        <Boton texto="Iniciar turno" onPress={() => void abrir()} cargando={abriendo} deshabilitado={!puerta} />
      </View>
    </ScrollView>
  );
}

function Cifra({ valor, etiqueta, tono }: { valor: number; etiqueta: string; tono: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 26, fontWeight: '900', color: tono }}>{valor}</Text>
      <Text style={{ fontSize: 12, fontWeight: '700', color: color.suave }}>{etiqueta}</Text>
    </View>
  );
}

const e = StyleSheet.create({
  hero: { position: 'absolute', left: espacio.l, right: espacio.l, bottom: 40, gap: 2 },
  heroEtiqueta: { color: color.acento, fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  titulo: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -0.8 },
  meta: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
  cifras: { flexDirection: 'row', backgroundColor: color.tarjeta, borderRadius: radio.m, paddingVertical: 16, ...sombra },
  puertas: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  puerta: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, backgroundColor: color.tarjeta, borderWidth: 1.5, borderColor: color.borde },
  puertaSel: { backgroundColor: color.primario, borderColor: color.primario },
  puertaTexto: { fontSize: 15, fontWeight: '700', color: color.texto },
});
