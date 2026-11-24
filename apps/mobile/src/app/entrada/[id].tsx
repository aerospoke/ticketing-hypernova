import { TOKEN_ROTACION_SEGUNDOS } from '@ticketing/shared';
import { randomUUID } from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api, ErrorApi, mensajeDeError } from '../../lib/api';
import { obtenerMaterial, parDispositivo } from '../../lib/billetera';
import { useCodigoRotativo } from '../../lib/codigo-rotativo';
import { useConsulta, useSesion } from '../../lib/usar';
import { Aviso, Boton, Campo, Cargando, ErrorVista, s, Seccion, Tarjeta, Vacio } from '../../ui/componentes';
import { fotoDe, Portada } from '../../ui/portada';
import { color, espacio, radio, sombra } from '../../ui/tema';
import { useBarraClara } from '../../ui/barra';

export default function EntradaPantalla() {
  useBarraClara();
  const { id, evento, evento_id } = useLocalSearchParams<{ id: string; evento?: string; evento_id?: string }>();
  const { sesion } = useSesion();
  const usuario = sesion?.usuario.id ?? '';

  const { datos, error, cargando, recargar } = useConsulta(async () => {
    const [{ material, offline }, par] = await Promise.all([obtenerMaterial(usuario, id), parDispositivo()]);
    return { material, offline, privada: par.privada };
  }, [usuario, id]);
  const { token, segundosParaRotar } = useCodigoRotativo(datos?.material ?? null, datos?.privada ?? null);

  const [email, setEmail] = useState('');
  const [accion, setAccion] = useState<'transferir' | 'reembolsar' | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tipo: 'info' | 'error' } | null>(null);
  const claveReembolso = useRef(`reemb-${randomUUID()}`);

  const encabezado = <Stack.Screen options={{ title: '', headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerTintColor: '#fff', headerShadowVisible: false }} />;
  if (cargando && !datos) return <>{encabezado}<Cargando texto="Preparando tu código…" /></>;
  if (error && !datos) {
    // 409: la entrada ya no genera código (usada, reembolsada, anulada).
    if (error instanceof ErrorApi && error.status === 409) {
      return <>{encabezado}<Vacio icono="cerrar" titulo="Esta entrada ya no está vigente" detalle={error.message} /></>;
    }
    return <>{encabezado}<ErrorVista error={error} reintentar={() => void recargar()} /></>;
  }

  async function transferir() {
    setAccion('transferir');
    setAviso(null);
    try {
      await api(`/v1/entradas/${id}/transferencias`, { metodo: 'POST', cuerpo: { email } });
      setAviso({ tipo: 'info', texto: `Transferencia enviada a ${email}. Queda pendiente hasta que la acepte; hasta entonces tu código sigue valiendo.` });
      setEmail('');
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDeError(e) });
    } finally {
      setAccion(null);
    }
  }

  async function reembolsar() {
    setAccion('reembolsar');
    setAviso(null);
    try {
      await api(`/v1/entradas/${id}/reembolso`, { metodo: 'POST', clave: claveReembolso.current });
      router.back();
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDeError(e) });
      setAccion(null);
    }
  }

  const progreso = Math.max(0, Math.min(1, segundosParaRotar / TOKEN_ROTACION_SEGUNDOS));
  return (
    // Con pantalla completa (edge-to-edge), Android no reacomoda la vista al abrir el teclado:
    // sin esto, el campo de transferir quedaría tapado.
    <KeyboardAvoidingView style={s.pantalla} behavior="padding">
    <ScrollView style={s.pantalla} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {encabezado}
      <Portada foto={fotoDe(evento_id ?? '0')} alto={240} hasta={0.95}>
        <View style={e.hero}>
          <Text style={e.heroEtiqueta}>TU ENTRADA</Text>
          <Text style={e.heroTitulo} numberOfLines={2}>{evento ?? 'Entrada'}</Text>
        </View>
      </Portada>

      <View style={[s.contenido, { marginTop: -56 }]}>
        <View style={e.qrTarjeta}>
          <View style={e.qrMarco}>
            {token ? <QRCode value={token} size={240} ecl="M" color={color.noche} /> : <View style={{ width: 240, height: 240 }}><Cargando /></View>}
          </View>
          <View style={e.rotacion}>
            <View style={[e.rotacionLlena, { width: `${Math.round(progreso * 100)}%` }]} />
          </View>
          <Text style={e.rotacionTexto} accessibilityLiveRegion="polite">
            🔄  El código cambia en {segundosParaRotar} s
          </Text>
          <Text style={[s.suave, { textAlign: 'center', fontSize: 13 }]}>
            Muéstralo en la puerta. Una captura no sirve: el escáner solo acepta códigos de los últimos 30 s generados en este teléfono.
          </Text>
          <View style={e.pie}>
            <View style={[e.muesca, { left: -32 }]} />
            <Text style={e.pieTexto}>Entrada #{id}</Text>
            <Text style={e.pieTexto}>Versión {datos?.material.version}</Text>
            <View style={[e.muesca, { right: -32 }]} />
          </View>
        </View>

        {datos?.offline ? <Aviso tipo="alerta" texto="✈️ Sin conexión: el código se genera en tu teléfono y funciona igual." /> : null}

        <Seccion titulo="Transferir" detalle="¿No puedes ir? Pásala a alguien con cuenta." />
        <Tarjeta>
          <Campo etiqueta="Correo de su cuenta" placeholder="amigo@correo.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Boton texto="Transferir entrada" onPress={transferir} cargando={accion === 'transferir'} deshabilitado={!email.includes('@') || accion !== null} />
          <Text style={[s.suave, { fontSize: 13 }]}>Cuando la acepte, tu código deja de servir y la entrada pasa a su billetera.</Text>
        </Tarjeta>

        {aviso ? <Aviso tipo={aviso.tipo} texto={aviso.texto} /> : null}

        <Seccion titulo="Reembolso" detalle="Solo hasta la fecha límite del evento y nunca después de haber entrado." />
        <Boton texto="Pedir reembolso" variante="secundario" onPress={reembolsar} cargando={accion === 'reembolsar'} deshabilitado={accion !== null} estilo={{ borderColor: '#f4c7c3' }} />
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const e = StyleSheet.create({
  hero: { position: 'absolute', left: espacio.l, right: espacio.l, bottom: 72 },
  heroEtiqueta: { color: color.acento, fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  heroTitulo: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
  qrTarjeta: { backgroundColor: color.tarjeta, borderRadius: radio.l, padding: espacio.l, alignItems: 'center', gap: 12, overflow: 'hidden', ...sombra },
  qrMarco: { padding: 14, borderRadius: radio.m, borderWidth: 2, borderColor: color.primarioSuave, backgroundColor: '#fff' },
  rotacion: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: color.fondo, overflow: 'hidden' },
  rotacionLlena: { height: 6, borderRadius: 3, backgroundColor: color.primario },
  rotacionTexto: { fontSize: 15, fontWeight: '800', color: color.texto },
  pie: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: color.fondo, borderStyle: 'solid', paddingTop: 14, marginTop: 4 },
  pieTexto: { fontSize: 13, fontWeight: '700', color: color.suave },
  muesca: { position: 'absolute', top: -12, width: 24, height: 24, borderRadius: 12, backgroundColor: color.fondo },
});
