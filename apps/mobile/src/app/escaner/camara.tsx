import { CameraView, useCameraPermissions } from 'expo-camera';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorApi, mensajeDeError } from '../../lib/api';
import {
  contarPendientes, escanear, resumenTurno, sincronizar, terminarTurno, turnoActual, ultimaSync, ultimosEscaneos, type Veredicto,
} from '../../lib/escaner';
import { Boton, Cargando, s } from '../../ui/componentes';
import { Icono } from '../../ui/icono';
import { color, radio } from '../../ui/tema';
import { useBarraClara } from '../../ui/barra';
import { MOTIVO, textoSync } from '../../ui/escaner-textos';
import { AvisoSinRed } from '../../ui/sin-red';

const PANTALLA: Record<Veredicto['tipo'], { titulo: string; fondo: string; ayuda: string }> = {
  valida: { titulo: 'VÁLIDA', fondo: color.exito, ayuda: 'Puede pasar' },
  ya_usada: { titulo: 'YA USADA', fondo: color.error, ayuda: 'Esta entrada ya ingresó por esta puerta' },
  revocada: { titulo: 'REVOCADA', fondo: color.error, ayuda: 'Transferida, reembolsada o anulada' },
  expirada: { titulo: 'CÓDIGO EXPIRADO', fondo: color.acento, ayuda: 'Puede ser una captura: pide abrir la entrada en la app' },
  otro_evento: { titulo: 'OTRO EVENTO', fondo: color.acento, ayuda: 'La entrada es de otro evento' },
  otra_zona: { titulo: 'ZONA EQUIVOCADA', fondo: color.acento, ayuda: 'La entrada es de otra zona' },
  invalida: { titulo: 'CÓDIGO INVÁLIDO', fondo: color.error, ayuda: 'La firma no es válida' },
};
const SYNC_AUTOMATICA_MS = 15_000;
/** Desde aquí se recuerda sincronizar. Solo avisa: el escáner nunca se bloquea (el enunciado
 * pide que funcione en modo avión y con miles de escaneos guardados). */
const AVISO_PENDIENTES = 10;

export default function Camara() {
  useBarraClara();
  const turno = turnoActual();
  const [permiso, pedirPermiso] = useCameraPermissions();
  const [activa, setActiva] = useState(true);
  const [veredicto, setVeredicto] = useState<Veredicto | null>(null);
  const [pendientes, setPendientes] = useState(contarPendientes);
  const [estadoSync, setEstadoSync] = useState<string>(() => textoSync(ultimaSync()));
  const [sincronizandoAhora, setSincronizandoAhora] = useState(false);
  const [terminando, setTerminando] = useState(false);
  const [avisoSinRed, setAvisoSinRed] = useState(false);
  const [historial, setHistorial] = useState(() => (turno ? ultimosEscaneos(turno.turno_id, 1) : []));
  const ultimo = useRef<{ data: string; en: number }>({ data: '', en: 0 });

  // Solo una cámara activa a la vez: se apaga al salir de la pantalla.
  useFocusEffect(useCallback(() => {
    setActiva(true);
    return () => setActiva(false);
  }, []));

  const refrescar = useCallback(() => {
    setPendientes(contarPendientes());
    if (turno) setHistorial(ultimosEscaneos(turno.turno_id, 1));
  }, [turno]);

  const sincronizarAhora = useCallback(async (manual: boolean) => {
    if (contarPendientes() === 0 && !manual) return;
    setSincronizandoAhora(true);
    try {
      const r = await sincronizar();
      setEstadoSync(r.duplicados > 0 ? `${r.duplicados} doble(s) ingreso(s) reportado(s)` : textoSync(ultimaSync()));
    } catch (e) {
      // Sin red: es lo esperado en modo avión. Los escaneos quedan guardados.
      const sinRed = e instanceof ErrorApi && e.sinConexion;
      setEstadoSync(sinRed || !manual ? `Sin conexión · ${textoSync(ultimaSync())}` : mensajeDeError(e));
      // Solo si lo pidió el staff: la sincronización automática no interrumpe en la puerta.
      if (manual && sinRed) setAvisoSinRed(true);
    } finally {
      setSincronizandoAhora(false);
      refrescar();
    }
  }, [refrescar]);

  // Sincronización automática cada 15 s mientras haya pendientes (si no hay red, no pasa nada).
  useEffect(() => {
    const t = setInterval(() => void sincronizarAhora(false), SYNC_AUTOMATICA_MS);
    return () => clearInterval(t);
  }, [sincronizarAhora]);

  const alEscanear = useCallback(({ data }: { data: string }) => {
    // La cámara reporta el mismo código muchas veces por segundo: se ignora 3 s.
    const ahora = Date.now();
    if (data === ultimo.current.data && ahora - ultimo.current.en < 3000) return;
    if (veredicto) return; // esperando que el staff descarte el resultado anterior
    ultimo.current = { data, en: ahora };
    setVeredicto(escanear(data));
    refrescar();
  }, [veredicto, refrescar]);

  if (!turno) return <Redirect href="/escaner" />;
  if (!permiso) return <Cargando texto="Revisando permisos de cámara…" />;
  if (!permiso.granted) {
    return (
      <SafeAreaView style={[s.pantalla, s.centro]}>
        <Text style={s.titulo}>Necesitamos la cámara</Text>
        <Text style={[s.suave, { textAlign: 'center' }]}>Se usa solo para leer los códigos de las entradas.</Text>
        <Boton texto="Permitir cámara" onPress={() => void pedirPermiso()} />
      </SafeAreaView>
    );
  }

  /**
   * Terminar: se intenta sincronizar y se cierra el turno. Sin red no se pierde nada: los
   * escaneos siguen en SQLite y se suben en la próxima sincronización (el servidor acepta
   * escaneos de un turno cerrado si vienen del mismo dispositivo). Después, el resumen.
   */
  async function terminar() {
    if (!turno) return;
    setTerminando(true);
    setActiva(false);
    await sincronizar().catch(() => undefined);
    await terminarTurno();
    router.replace({ pathname: '/escaner/resumen', params: { turno: turno.turno_id, evento: turno.evento, puerta: turno.puerta } });
  }

  const resumen = resumenTurno(turno.turno_id);
  const ult = historial[0];
  const sinRed = estadoSync.startsWith('Sin conexión');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.noche }} edges={['top', 'bottom']}>
      <View style={st.barra}>
        <View style={{ flex: 1 }}>
          <Text style={st.barraEtiqueta}>ESCANEANDO EN</Text>
          <Text style={st.barraTitulo}>{turno.puerta}</Text>
          <Text style={st.barraTexto} numberOfLines={1}>{turno.evento}</Text>
        </View>
        <View style={[st.estado, { backgroundColor: sinRed ? 'rgba(245,153,29,0.18)' : 'rgba(15,157,88,0.18)' }]}>
          <View style={[st.punto, { backgroundColor: sinRed ? color.acento : color.exito }]} />
          <Text style={[st.estadoTexto, { color: sinRed ? color.acento : '#5fd39a' }]}>{sinRed ? 'Sin red' : 'En línea'}</Text>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {activa ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={veredicto ? undefined : alEscanear} />
        ) : null}
        {!veredicto ? (
          <View pointerEvents="none" style={st.guia}>
            <View style={st.marco}>
              <View style={[st.esquina, { top: -3, left: -3, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 20 }]} />
              <View style={[st.esquina, { top: -3, right: -3, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 20 }]} />
              <View style={[st.esquina, { bottom: -3, left: -3, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 20 }]} />
              <View style={[st.esquina, { bottom: -3, right: -3, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 20 }]} />
            </View>
            <Text style={st.guiaTexto}>Apunta al código de la entrada</Text>
          </View>
        ) : null}
        {veredicto ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Escanear siguiente" onPress={() => setVeredicto(null)} style={[st.resultado, { backgroundColor: PANTALLA[veredicto.tipo].fondo }]}>
            <View style={st.resultadoIcono}>
              <Icono nombre={veredicto.tipo === 'valida' ? 'listo' : 'cerrar'} tam={72} />
            </View>
            <Text accessibilityLiveRegion="assertive" style={st.resultadoTitulo}>{PANTALLA[veredicto.tipo].titulo}</Text>
            <Text style={st.resultadoAyuda}>{PANTALLA[veredicto.tipo].ayuda}</Text>
            {'entrada' in veredicto && veredicto.entrada ? <Text style={st.resultadoEntrada}>Entrada #{veredicto.entrada}</Text> : null}
            <View style={st.resultadoBoton}>
              <Text style={st.resultadoBotonTexto}>Toca para escanear la siguiente</Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      <View style={st.panel}>
        <View style={st.cifras}>
          <Cifra valor={resumen.validos ?? 0} etiqueta="Válidas" tono={color.exito} />
          <Cifra valor={resumen.rechazos ?? 0} etiqueta="Rechazos" tono={color.error} />
          <Cifra valor={pendientes} etiqueta="Por sincronizar" tono={pendientes > 0 ? color.alerta : color.suave} />
        </View>
        {pendientes >= AVISO_PENDIENTES ? (
          <View style={st.recordatorio} accessibilityRole="alert">
            <Text style={st.recordatorioTexto}>
              ⚠️ {pendientes} escaneos sin sincronizar. Sincroniza la información cuando tengas red; mientras tanto puedes seguir escaneando.
            </Text>
          </View>
        ) : null}
        <Text style={st.sync} numberOfLines={2}>
          {ult ? `Último: #${ult.entrada_id ?? '?'} · ${ult.resultado === 'valido' ? 'válida' : MOTIVO[ult.motivo ?? ''] ?? 'rechazada'}  ·  ` : ''}{estadoSync}
        </Text>
        <Boton texto="Sincronizar ahora" onPress={() => void sincronizarAhora(true)} cargando={sincronizandoAhora} deshabilitado={terminando} />
        <Boton texto="Cambiar de puerta" variante="secundario" onPress={() => router.replace('/escaner')} deshabilitado={terminando} />
        <Boton texto="Terminar turno" variante="secundario" onPress={() => void terminar()} cargando={terminando} estilo={{ borderColor: '#f4c7c3' }} />
      </View>
      <AvisoSinRed visible={avisoSinRed} pendientes={pendientes} cerrar={() => setAvisoSinRed(false)} />
    </SafeAreaView>
  );
}

function Cifra({ valor, etiqueta, tono }: { valor: number; etiqueta: string; tono: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 26, fontWeight: '900', color: tono, fontVariant: ['tabular-nums'] }}>{valor}</Text>
      <Text style={{ fontSize: 12, fontWeight: '700', color: color.suave }}>{etiqueta}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  barra: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  barraEtiqueta: { color: color.acento, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  barraTitulo: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  barraTexto: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  estado: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  estadoTexto: { fontSize: 13, fontWeight: '800' },
  guia: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 18 },
  marco: { width: '68%', aspectRatio: 1 },
  esquina: { position: 'absolute', width: 44, height: 44, borderColor: '#fff' },
  guiaTexto: { color: '#fff', fontSize: 15, fontWeight: '700', backgroundColor: 'rgba(18,13,31,0.6)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, overflow: 'hidden' },
  resultado: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  resultadoIcono: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  resultadoTitulo: { color: '#fff', fontSize: 42, fontWeight: '900', textAlign: 'center', letterSpacing: -1 },
  resultadoAyuda: { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center', opacity: 0.92 },
  resultadoEntrada: { color: '#fff', fontSize: 16, fontWeight: '800', opacity: 0.85 },
  resultadoBoton: { marginTop: 18, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 },
  resultadoBotonTexto: { color: '#fff', fontSize: 16, fontWeight: '800' },
  panel: { backgroundColor: color.fondo, borderTopLeftRadius: radio.l, borderTopRightRadius: radio.l, padding: 18, gap: 10 },
  cifras: { flexDirection: 'row', backgroundColor: color.tarjeta, borderRadius: radio.m, paddingVertical: 10 },
  sync: { fontSize: 13, color: color.suave, textAlign: 'center' },
  recordatorio: { backgroundColor: '#fff4e5', borderLeftWidth: 4, borderLeftColor: color.acento, borderRadius: radio.s, paddingVertical: 10, paddingHorizontal: 12 },
  recordatorioTexto: { fontSize: 14, lineHeight: 19, color: color.texto, fontWeight: '600' },
});
