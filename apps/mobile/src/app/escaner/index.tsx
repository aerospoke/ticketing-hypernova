import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { cerrarSesion, mensajeDeError } from '../../lib/api';
import { type EventoAsignado, contarPendientes, iniciarTurno, misEventos, turnoActual } from '../../lib/escaner';
import { useConsulta, useSesion } from '../../lib/usar';
import { Aviso, Boton, Cargando, ErrorVista, s, Tarjeta, Vacio } from '../../ui/componentes';
import { color, fecha } from '../../ui/tema';

/** Inicio de turno: el staff elige evento y puerta. Necesita red una vez; después, no. */
export default function InicioTurno() {
  const { sesion, cargada } = useSesion();
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
    <ScrollView style={s.pantalla} contentContainerStyle={s.contenido} refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => void recargar(true)} />}>
      <Text style={s.suave}>Hola, {sesion?.usuario.nombre}. Elige tu puerta para empezar a escanear.</Text>

      {turno ? (
        <Tarjeta>
          <Text style={s.subtitulo}>Turno en curso</Text>
          <Text style={s.texto}>{turno.evento} · {turno.puerta}</Text>
          <Text style={s.suave}>{contarPendientes()} escaneos sin sincronizar</Text>
          <Boton texto="Continuar escaneando" onPress={() => router.replace('/escaner/camara')} />
        </Tarjeta>
      ) : null}

      {cargando && !datos ? <Cargando texto="Buscando tus eventos…" /> : null}
      {error && !datos ? <ErrorVista error={error} reintentar={() => void recargar()} /> : null}
      {datos && datos.length === 0 ? <Vacio titulo="No tienes eventos asignados" detalle="Pide al organizador que te asigne a un evento." /> : null}

      {datos?.map((ev) => (
        <Tarjeta key={ev.id}>
          <Text style={s.subtitulo}>{ev.nombre}</Text>
          <Text style={s.suave}>{fecha(ev.fecha)} · {ev.recinto}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ev.puertas.length === 0 ? <Text style={s.suave}>El evento no tiene puertas configuradas.</Text> : null}
            {ev.puertas.map((p) => {
              const sel = elegido?.puerta === p.id;
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sel }}
                  onPress={() => setElegido({ evento: ev, puerta: p.id })}
                  style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: sel ? 2 : 1, borderColor: sel ? color.primario : color.borde, backgroundColor: color.tarjeta }}
                >
                  <Text style={[s.texto, sel && { color: color.primario, fontWeight: '700' }]}>{p.nombre}</Text>
                </Pressable>
              );
            })}
          </View>
        </Tarjeta>
      ))}

      {fallo ? <Aviso tipo="error" texto={fallo} /> : null}
      <Boton texto="Iniciar turno" onPress={abrir} cargando={abriendo} deshabilitado={!elegido} />
      <Text style={s.suave}>Al iniciar se descarga la lista de entradas revocadas. Después puedes activar el modo avión.</Text>
      <Boton texto="Cerrar sesión" variante="secundario" onPress={async () => { await cerrarSesion(); router.replace('/login'); }} />
    </ScrollView>
  );
}
