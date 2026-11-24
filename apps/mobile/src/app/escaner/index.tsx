import { Redirect, router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cerrarSesion } from '../../lib/api';
import { contarPendientes, misEventos, turnoActual } from '../../lib/escaner';
import { useConsulta, useSesion } from '../../lib/usar';
import { Boton, Cargando, ErrorVista, s, Seccion, TapaSuperior, Vacio } from '../../ui/componentes';
import { Icono } from '../../ui/icono';
import { fotoDe, Portada } from '../../ui/portada';
import { color, espacio, fecha, radio, sombra } from '../../ui/tema';
import { useBarraClara } from '../../ui/barra';

/** Inicio del staff: sus eventos asignados. Cada uno abre su detalle para elegir puerta. */
export default function InicioStaff() {
  useBarraClara();
  const { sesion, cargada } = useSesion();
  const arriba = useSafeAreaInsets().top;
  const turno = turnoActual();
  const { datos, error, cargando, refrescando, recargar } = useConsulta(() => misEventos());

  if (cargada && !sesion) return <Redirect href="/login" />;

  const total = (datos ?? []).reduce(
    (t, e) => ({ validos: t.validos + e.mis_cifras.validos, incidentes: t.incidentes + e.mis_cifras.incidentes_abiertos }),
    { validos: 0, incidentes: 0 },
  );
  const pendientes = contarPendientes();

  return (
    <View style={s.pantalla}>
      <ScrollView style={s.pantalla} contentContainerStyle={{ paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refrescando} tintColor="#fff" onRefresh={() => void recargar(true)} />}>
        <View style={[e.cabecera, { paddingTop: arriba + espacio.l }]}>
          <View style={e.marca}>
            <Icono nombre="boleto" tam={20} tinte="#fff" />
            <Text style={e.marcaTexto}>MODO ESCÁNER</Text>
          </View>
          <Text style={e.hola}>Hola, {sesion?.usuario.nombre.split(' ')[0]}</Text>
          <Text style={e.ayuda}>Elige un evento para ver tu actividad y empezar a validar entradas.</Text>
          {datos && datos.length > 0 ? (
            <View style={e.cifras}>
              <Cifra valor={total.validos} etiqueta="ingresos validados" />
              <Cifra valor={total.incidentes} etiqueta="incidentes abiertos" alerta={total.incidentes > 0} />
              <Cifra valor={pendientes} etiqueta="sin sincronizar" alerta={pendientes > 0} />
            </View>
          ) : null}
        </View>

        <View style={s.contenido}>
          {turno ? (
            <View style={e.turno}>
              <View style={s.fila}>
                <View style={e.enVivo} />
                <Text style={[s.etiqueta, { flex: 1, color: color.exito }]}>TURNO EN CURSO</Text>
              </View>
              <Text style={s.subtitulo}>{turno.evento} · {turno.puerta}</Text>
              <Boton texto="Continuar escaneando" onPress={() => router.replace('/escaner/camara')} />
            </View>
          ) : null}

          <Seccion titulo="Tus eventos asignados" />
          {cargando && !datos ? <Cargando texto="Buscando tus eventos…" /> : null}
          {error && !datos ? <ErrorVista error={error} reintentar={() => void recargar()} /> : null}
          {datos && datos.length === 0 ? <Vacio titulo="No tienes eventos asignados" detalle="Pide al organizador que te asigne a un evento." /> : null}

          {datos?.map((ev) => (
            <Pressable
              key={ev.id}
              accessibilityRole="button"
              accessibilityLabel={`Validar en ${ev.nombre}`}
              onPress={() => router.push({ pathname: '/escaner/evento', params: { id: ev.id } })}
              style={({ pressed }) => [e.evento, { transform: [{ scale: pressed ? 0.985 : 1 }] }]}
            >
              <Portada foto={fotoDe(ev.id)} alto={150}>
                {ev.mis_cifras.incidentes_abiertos > 0 ? (
                  <View style={e.alerta}>
                    <Text style={e.alertaTexto}>⚠️ {ev.mis_cifras.incidentes_abiertos} incidente(s)</Text>
                  </View>
                ) : null}
                <View style={{ position: 'absolute', left: 16, right: 16, bottom: 14 }}>
                  <Text style={e.eventoNombre} numberOfLines={1}>{ev.nombre}</Text>
                  <Text style={e.eventoMeta} numberOfLines={1}>{fecha(ev.fecha)} · {ev.recinto}</Text>
                </View>
              </Portada>
              <View style={e.pie}>
                <Text style={[s.suave, { flex: 1 }]} numberOfLines={1}>
                  {ev.mis_cifras.validos > 0 ? `${ev.mis_cifras.validos} validadas por ti` : `${ev.puertas.length} puerta(s)`}
                </Text>
                <Text style={e.boton}>Validar en este evento ›</Text>
              </View>
            </Pressable>
          ))}

          <Boton texto="Cerrar sesión" variante="secundario" onPress={async () => { await cerrarSesion(); router.replace('/login'); }} estilo={{ marginTop: espacio.m }} />
        </View>
      </ScrollView>
      <TapaSuperior alto={arriba} tono={color.noche} />
    </View>
  );
}

function Cifra({ valor, etiqueta, alerta = false }: { valor: number; etiqueta: string; alerta?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color: alerta ? color.acento : '#fff', fontSize: 22, fontWeight: '900' }}>{valor}</Text>
      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, textAlign: 'center' }}>{etiqueta}</Text>
    </View>
  );
}

const e = StyleSheet.create({
  cabecera: { backgroundColor: color.noche, paddingHorizontal: espacio.l, paddingBottom: espacio.xl, gap: 6 },
  marca: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: color.primario, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  marcaTexto: { color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 1.5 },
  hola: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -1, marginTop: 10 },
  ayuda: { color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 21 },
  cifras: { flexDirection: 'row', marginTop: espacio.m, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: radio.m, paddingVertical: 12 },
  turno: { backgroundColor: color.tarjeta, borderRadius: radio.m, padding: espacio.l, gap: 8, borderLeftWidth: 5, borderLeftColor: color.exito, ...sombra },
  enVivo: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.exito },
  evento: { backgroundColor: color.tarjeta, borderRadius: radio.m, overflow: 'hidden', ...sombra },
  eventoNombre: { color: '#fff', fontSize: 20, fontWeight: '900' },
  eventoMeta: { color: 'rgba(255,255,255,0.82)', fontSize: 13 },
  alerta: { position: 'absolute', top: 12, right: 12, backgroundColor: color.acento, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  alertaTexto: { color: '#fff', fontWeight: '800', fontSize: 12 },
  pie: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  boton: { color: color.primario, fontWeight: '800', fontSize: 15 },
});
