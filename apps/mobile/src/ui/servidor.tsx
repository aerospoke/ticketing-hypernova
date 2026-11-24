/**
 * "Servidor: http://…:3000 · Cambiar" en el login. Permite que un mismo APK funcione en la
 * red de quien lo prueba. Solo se muestra sin sesión abierta, así los tokens de un servidor
 * nunca se envían a otro.
 *
 * El editor se abre en una ventana arriba de la pantalla: abajo lo taparía el teclado
 * (con pantalla completa, Android no reacomoda la vista al abrirlo).
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiUrl, cambiarServidor, probarServidor } from '../lib/config';
import { Boton, Campo } from './componentes';
import { color, espacio, radio, sombra } from './tema';

type Prueba = { estado: 'probando' } | { estado: 'ok' } | { estado: 'falla'; texto: string } | null;

/**
 * Punto de partida para escribir: si ya hay una IP de red guardada, esa; si no (localhost o
 * algo inválido de versiones anteriores), "http://192.168.1." y basta con completar el final.
 */
function sugerencia(url: string) {
  const ipDeRed = /^https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(url) && !url.includes('127.0.0.1');
  return ipDeRed ? url : 'http://192.168.1.';
}

export function ServidorEditable() {
  const arriba = useSafeAreaInsets().top;
  const [url, setUrl] = useState(apiUrl);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [prueba, setPrueba] = useState<Prueba>(null);

  function abrir() {
    setTexto(sugerencia(url));
    setPrueba(null);
    setEditando(true);
  }

  async function guardar() {
    let nueva: string;
    try {
      nueva = cambiarServidor(texto);
    } catch (e) {
      setPrueba({ estado: 'falla', texto: (e as Error).message });
      return;
    }
    setUrl(nueva);
    setTexto(nueva);
    setPrueba({ estado: 'probando' });
    const ok = await probarServidor(nueva);
    setPrueba(ok ? { estado: 'ok' } : { estado: 'falla', texto: 'Guardado, pero no responde. ¿La API está levantada con API_BIND=0.0.0.0 y el teléfono en la misma red?' });
    if (ok) setTimeout(() => setEditando(false), 700);
  }

  return (
    <View style={e.caja}>
      <View style={e.fila}>
        <View style={{ flex: 1 }}>
          <Text style={e.etiqueta}>SERVIDOR</Text>
          <Text style={e.url} numberOfLines={1}>{url}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={abrir} hitSlop={10}>
          <Text style={e.cambiar}>Cambiar</Text>
        </Pressable>
      </View>
      {prueba?.estado === 'ok' && !editando ? <Text style={[e.resultado, { color: color.exito }]}>✓ Conectado</Text> : null}

      <Modal visible={editando} transparent animationType="fade" onRequestClose={() => setEditando(false)} statusBarTranslucent>
        <Pressable style={e.fondo} onPress={() => setEditando(false)} accessibilityLabel="Cerrar" />
        <View style={[e.ventana, { top: arriba + 24 }]}>
          <Text style={e.titulo}>Servidor de la API</Text>
          <Text style={e.ayuda}>La IP de la computadora donde corre Docker, con el puerto 3000. En esa computadora: ipconfig getifaddr en0 (Mac) o ipconfig (Windows).</Text>
          <Campo
            etiqueta="Dirección"
            value={texto}
            onChangeText={setTexto}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.50:3000"
            onSubmitEditing={guardar}
          />
          {prueba?.estado === 'ok' ? <Text style={[e.resultado, { color: color.exito }]}>✓ Conectado</Text> : null}
          {prueba?.estado === 'falla' ? <Text style={[e.resultado, { color: color.error }]}>{prueba.texto}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Boton texto="Cancelar" variante="secundario" onPress={() => setEditando(false)} estilo={{ flex: 1 }} />
            <Boton texto="Conectar" onPress={guardar} cargando={prueba?.estado === 'probando'} estilo={{ flex: 1 }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const e = StyleSheet.create({
  caja: { backgroundColor: color.fondo, borderRadius: radio.s, padding: 14, marginTop: 4 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  etiqueta: { fontSize: 11, fontWeight: '800', color: color.suave, letterSpacing: 1 },
  url: { fontSize: 14, color: color.texto, fontWeight: '600', marginTop: 2 },
  cambiar: { color: color.primario, fontWeight: '800', fontSize: 14 },
  resultado: { fontSize: 13, fontWeight: '700', marginTop: 8 },
  fondo: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(18,13,31,0.55)' },
  ventana: { position: 'absolute', left: espacio.l, right: espacio.l, backgroundColor: color.tarjeta, borderRadius: radio.l, padding: espacio.l, gap: 12, ...sombra },
  titulo: { fontSize: 20, fontWeight: '900', color: color.texto },
  ayuda: { fontSize: 13, color: color.suave, lineHeight: 19 },
});
