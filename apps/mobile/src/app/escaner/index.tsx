import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cerrarSesion, mensajeDeError } from '../../lib/api';
import { type EventoAsignado, contarPendientes, iniciarTurno, misEventos, turnoActual } from '../../lib/escaner';
import { useConsulta, useSesion } from '../../lib/usar';
import { Aviso, Boton, Cargando, ErrorVista, s, Seccion, TapaSuperior, Vacio } from '../../ui/componentes';
import { Icono } from '../../ui/icono';
import { fotoDe, Portada } from '../../ui/portada';
import { color, espacio, fecha, radio, sombra } from '../../ui/tema';
import { useBarraClara } from '../../ui/barra';

/** Inicio de turno: el staff elige evento y puerta. Necesita red una vez; después, no. */
export default function InicioTurno() {
  useBarraClara();
  const { sesion, cargada } = useSesion();
  const arriba = useSafeAreaInsets().top;
  const turno = turnoActual();
  const { datos, error, cargando, refrescando, recargar } = useConsulta(() => misEventos());
  const [elegido, setElegido] = useState<{ evento: EventoAsignado; puerta: string } | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  if (cargada && !sesion) return <Redirect href="/login" />;

  async function abrir() {
    if (!elegido) return;
    setAbriendo(true);
    setFallo(null);
    try {
      await iniciarTurno(elegido.evento, elegido.puerta);
      router.replace('/escaner/camara');
    } catch (e) {
      setFallo(mensajeDeError(e));
    } finally {
      setAbriendo(false);
    }
  }

  return (
    <View style={s.pantalla}>
    <ScrollView style={s.pantalla} contentContainerStyle={{ paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refrescando} tintColor="#fff" onRefresh={() => void recargar(true)} />}>
      <View style={[e.cabecera, { paddingTop: arriba + espacio.l }, !turno && { paddingBottom: espacio.xl }]}>
        <View style={e.marca}>
          <Icono nombre="boleto" tam={20} tinte="#fff" />
          <Text style={e.marcaTexto}>MODO ESCÁNER</Text>
        </View>
        <Text style={e.hola}>Hola, {sesion?.usuario.nombre.split(' ')[0]}</Text>
        <Text style={e.ayuda}>Elige tu puerta, inicia el turno y después puedes activar el modo avión: el escáner sigue funcionando.</Text>
      </View>

      <View style={[s.contenido, turno ? { marginTop: -24 } : { paddingTop: espacio.l }]}>
        {turno ? (
          <View style={e.turno}>
            <View style={s.fila}>
              <View style={e.enVivo} />
              <Text style={[s.etiqueta, { flex: 1, color: color.exito }]}>TURNO EN CURSO</Text>
            </View>
            <Text style={s.subtitulo}>{turno.evento} · {turno.puerta}</Text>
            <Text style={s.suave}>{contarPendientes()} escaneos sin sincronizar</Text>
            <Boton texto="Continuar escaneando" onPress={() => router.replace('/escaner/camara')} />
          </View>
        ) : null}

        <Seccion titulo="Tus eventos asignados" detalle="Toca la puerta donde vas a estar." />
        {cargando && !datos ? <Cargando texto="Buscando tus eventos…" /> : null}
        {error && !datos ? <ErrorVista error={error} reintentar={() => void recargar()} /> : null}
        {datos && datos.length === 0 ? <Vacio titulo="No tienes eventos asignados" detalle="Pide al organizador que te asigne a un evento." /> : null}

        {datos?.map((ev) => (
          <View key={ev.id} style={e.evento}>
            <Portada foto={fotoDe(ev.id)} alto={130}>
              <View style={{ position: 'absolute', left: 16, right: 16, bottom: 14 }}>
                <Text style={e.eventoNombre} numberOfLines={1}>{ev.nombre}</Text>
                <Text style={e.eventoMeta} numberOfLines={1}>{fecha(ev.fecha)} · {ev.recinto}</Text>
              </View>
            </Portada>
            <View style={e.puertas}>
              {ev.puertas.length === 0 ? <Text style={s.suave}>El evento no tiene puertas configuradas.</Text> : null}
              {ev.puertas.map((p) => {
                const sel = elegido?.puerta === p.id;
                return (
                  <Pressable
                    key={p.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                    onPress={() => setElegido({ evento: ev, puerta: p.id })}
                    style={[e.puerta, sel && e.puertaSel]}
                  >
                    <Text style={[e.puertaTexto, sel && { color: '#fff' }]}>🚪  {p.nombre}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {fallo ? <Aviso tipo="error" texto={fallo} /> : null}
        <Boton texto="Iniciar turno" onPress={abrir} cargando={abriendo} deshabilitado={!elegido} />
        <Text style={[s.suave, { textAlign: 'center', fontSize: 13 }]}>Al iniciar se descarga la lista de entradas revocadas.</Text>
        <Boton texto="Cerrar sesión" variante="secundario" onPress={async () => { await cerrarSesion(); router.replace('/login'); }} />
      </View>
    </ScrollView>
    <TapaSuperior alto={arriba} tono={color.noche} />
    </View>
  );
}

const e = StyleSheet.create({
  cabecera: { backgroundColor: color.noche, paddingHorizontal: espacio.l, paddingBottom: 48, gap: 6 },
  marca: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: color.primario, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  marcaTexto: { color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 1.5 },
  hola: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -1, marginTop: 10 },
  ayuda: { color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 21 },
  turno: { backgroundColor: color.tarjeta, borderRadius: radio.m, padding: espacio.l, gap: 8, borderLeftWidth: 5, borderLeftColor: color.exito, ...sombra },
  enVivo: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.exito },
  evento: { backgroundColor: color.tarjeta, borderRadius: radio.m, overflow: 'hidden', ...sombra },
  eventoNombre: { color: '#fff', fontSize: 20, fontWeight: '900' },
  eventoMeta: { color: 'rgba(255,255,255,0.82)', fontSize: 13 },
  puertas: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 16 },
  puerta: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, backgroundColor: color.fondo, borderWidth: 1.5, borderColor: color.borde },
  puertaSel: { backgroundColor: color.primario, borderColor: color.primario },
  puertaTexto: { fontSize: 15, fontWeight: '700', color: color.texto },
});
