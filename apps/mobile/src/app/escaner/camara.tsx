import { CameraView, useCameraPermissions } from 'expo-camera';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mensajeDeError } from '../../lib/api';
import {
  contarPendientes, escanear, resumenTurno, sincronizar, terminarTurno, turnoActual, ultimaSync, ultimosEscaneos, type Veredicto,
} from '../../lib/escaner';
import { Boton, Cargando, s } from '../../ui/componentes';
import { Icono } from '../../ui/icono';
import { color } from '../../ui/tema';

const PANTALLA: Record<Veredicto['tipo'], { titulo: string; fondo: string }> = {
  valida: { titulo: 'VÁLIDA', fondo: color.exito },
  ya_usada: { titulo: 'YA USADA', fondo: color.error },
  revocada: { titulo: 'REVOCADA', fondo: color.error },
  expirada: { titulo: 'CÓDIGO EXPIRADO', fondo: color.alerta },
  otro_evento: { titulo: 'OTRO EVENTO', fondo: color.alerta },
  otra_zona: { titulo: 'ZONA EQUIVOCADA', fondo: color.alerta },
  invalida: { titulo: 'CÓDIGO INVÁLIDO', fondo: color.error },
};
const SYNC_AUTOMATICA_MS = 15_000;

export default function Camara() {
  const turno = turnoActual();
  const [permiso, pedirPermiso] = useCameraPermissions();
  const [activa, setActiva] = useState(true);
  const [veredicto, setVeredicto] = useState<Veredicto | null>(null);
  const [pendientes, setPendientes] = useState(contarPendientes);
  const [estadoSync, setEstadoSync] = useState<string>(() => textoSync(ultimaSync()));
  const [sincronizandoAhora, setSincronizandoAhora] = useState(false);
  const [historial, setHistorial] = useState(() => (turno ? ultimosEscaneos(turno.turno_id) : []));
  const ultimo = useRef<{ data: string; en: number }>({ data: '', en: 0 });

  // Solo una cámara activa a la vez: se apaga al salir de la pantalla.
  useFocusEffect(useCallback(() => {
    setActiva(true);
    return () => setActiva(false);
  }, []));

  const refrescar = useCallback(() => {
    setPendientes(contarPendientes());
    if (turno) setHistorial(ultimosEscaneos(turno.turno_id));
  }, [turno]);

  const sincronizarAhora = useCallback(async (manual: boolean) => {
    if (contarPendientes() === 0 && !manual) return;
    setSincronizandoAhora(true);
    try {
      const r = await sincronizar();
      setEstadoSync(r.duplicados > 0 ? `Sincronizado · ${r.duplicados} doble(s) ingreso(s) reportado(s)` : textoSync(ultimaSync()));
    } catch (e) {
      // Sin red: es lo esperado en modo avión. Los escaneos quedan guardados.
      setEstadoSync(manual ? mensajeDeError(e) : `Sin conexión · ${textoSync(ultimaSync())}`);
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

  const resumen = resumenTurno(turno.turno_id);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top', 'bottom']}>
      <View style={st.barra}>
        <View style={{ flex: 1 }}>
          <Text style={st.barraTitulo}>{turno.puerta}</Text>
          <Text style={st.barraTexto} numberOfLines={1}>{turno.evento}</Text>
        </View>
        <View style={[st.contador, { backgroundColor: pendientes > 0 ? color.alerta : color.exito }]}>
          <Text style={st.contadorNumero}>{pendientes}</Text>
          <Text style={st.contadorTexto}>pendientes</Text>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {activa ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={veredicto ? undefined : alEscanear} />
        ) : null}
        <View pointerEvents="none" style={st.marco} />
        {veredicto ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Escanear siguiente" onPress={() => setVeredicto(null)} style={[st.resultado, { backgroundColor: PANTALLA[veredicto.tipo].fondo }]}>
            <Icono nombre={veredicto.tipo === 'valida' ? 'listo' : 'cerrar'} tam={96} tinte="#fff" />
            <Text accessibilityLiveRegion="assertive" style={st.resultadoTitulo}>{PANTALLA[veredicto.tipo].titulo}</Text>
            {'entrada' in veredicto && veredicto.entrada ? <Text style={st.resultadoTexto}>Entrada #{veredicto.entrada}</Text> : null}
            <Text style={st.resultadoTexto}>Toca para escanear la siguiente</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={st.panel}>
        <Text style={st.panelTexto}>Válidas {resumen.validos ?? 0} · Rechazos {resumen.rechazos ?? 0} · {estadoSync}</Text>
        <FlatList
          horizontal
          data={historial.slice(0, 20)}
          keyExtractor={(e) => e.client_scan_id}
          renderItem={({ item }) => (
            <View style={[st.chip, { borderColor: item.resultado === 'valido' ? color.exito : color.error }]}>
              <Text style={st.chipTexto}>#{item.entrada_id ?? '?'} {item.resultado === 'valido' ? '✓' : item.motivo}</Text>
              <Text style={st.chipTexto}>{item.sincronizado ? (item.resultado_servidor === 'duplicado_offline' ? 'DOBLE INGRESO' : 'sincronizado') : 'pendiente'}</Text>
            </View>
          )}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Boton texto="Sincronizar" onPress={() => void sincronizarAhora(true)} cargando={sincronizandoAhora} estilo={{ flex: 1 }} />
          <Boton texto="Cambiar puerta" variante="secundario" onPress={() => router.replace('/escaner')} estilo={{ flex: 1 }} />
          <Boton texto="Terminar" variante="secundario" onPress={async () => { await terminarTurno(); router.replace('/escaner'); }} estilo={{ flex: 1 }} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function textoSync(iso: string | null) {
  if (!iso) return 'Nunca sincronizado';
  const seg = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return seg < 60 ? `Sincronizado hace ${seg} s` : `Sincronizado hace ${Math.round(seg / 60)} min`;
}

const st = StyleSheet.create({
  barra: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, backgroundColor: '#092333' },
  barraTitulo: { color: '#fff', fontSize: 18, fontWeight: '700' },
  barraTexto: { color: '#c8d3db', fontSize: 13 },
  contador: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  contadorNumero: { color: '#fff', fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  contadorTexto: { color: '#fff', fontSize: 11 },
  marco: { position: 'absolute', top: '20%', left: '15%', right: '15%', aspectRatio: 1, borderWidth: 3, borderColor: 'rgba(255,255,255,0.8)', borderRadius: 16 },
  resultado: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  resultadoTitulo: { color: '#fff', fontSize: 40, fontWeight: '900', textAlign: 'center' },
  resultadoTexto: { color: '#fff', fontSize: 18, fontWeight: '600' },
  panel: { backgroundColor: '#092333', padding: 12, gap: 10 },
  panelTexto: { color: '#c8d3db', fontSize: 13 },
  chip: { borderWidth: 2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8 },
  chipTexto: { color: '#fff', fontSize: 12 },
});
