import { randomUUID } from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api, ErrorApi, mensajeDeError } from '../../lib/api';
import { obtenerMaterial, parDispositivo } from '../../lib/billetera';
import { useCodigoRotativo } from '../../lib/codigo-rotativo';
import { useConsulta, useSesion } from '../../lib/usar';
import { Aviso, Boton, Campo, Cargando, ErrorVista, s, Tarjeta } from '../../ui/componentes';
import { Icono } from '../../ui/icono';
import { color } from '../../ui/tema';

export default function EntradaPantalla() {
  const { id, evento } = useLocalSearchParams<{ id: string; evento?: string }>();
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

  if (cargando && !datos) return <Cargando texto="Preparando tu código…" />;
  if (error && !datos) {
    // 409: la entrada ya no genera código (usada, reembolsada, anulada).
    if (error instanceof ErrorApi && error.status === 409) {
      return (
        <View style={[s.pantalla, s.centro]}>
          <Text style={s.titulo}>Esta entrada ya no está vigente</Text>
          <Text style={s.suave}>{error.message}</Text>
        </View>
      );
    }
    return <ErrorVista error={error} reintentar={() => void recargar()} />;
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

  return (
    <ScrollView style={s.pantalla} contentContainerStyle={s.contenido} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: evento ?? 'Entrada' }} />
      {datos?.offline ? <Aviso tipo="alerta" texto="Sin conexión: el código se genera en tu teléfono y funciona igual." /> : null}
      <Tarjeta estilo={{ alignItems: 'center', paddingVertical: 24 }}>
        {token ? <QRCode value={token} size={260} ecl="M" /> : <Cargando />}
        <Text style={[s.suave, { marginTop: 12 }]} accessibilityLiveRegion="polite">
          El código cambia en {segundosParaRotar} s
        </Text>
        <Text style={[s.suave, { textAlign: 'center' }]}>Una captura de pantalla no sirve: el escáner solo acepta códigos de los últimos 30 segundos generados en este teléfono.</Text>
      </Tarjeta>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icono nombre="boleto" tam={22} />
        <Text style={s.suave}>Entrada #{id} · versión {datos?.material.version}</Text>
      </View>

      <Tarjeta>
        <Text style={s.subtitulo}>Transferir a otra persona</Text>
        <Campo etiqueta="Correo de su cuenta" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <Boton texto="Transferir" onPress={transferir} cargando={accion === 'transferir'} deshabilitado={!email.includes('@') || accion !== null} />
        <Text style={s.suave}>Cuando la acepte, tu código deja de servir y la entrada pasa a su billetera.</Text>
      </Tarjeta>

      {aviso ? <Aviso tipo={aviso.tipo} texto={aviso.texto} /> : null}
      <Boton texto="Pedir reembolso" variante="peligro" onPress={reembolsar} cargando={accion === 'reembolsar'} deshabilitado={accion !== null} />
      <Text style={[s.suave, { color: color.suave }]}>Solo hasta la fecha límite del evento y nunca después de haber entrado.</Text>
    </ScrollView>
  );
}
