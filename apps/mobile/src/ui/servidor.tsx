/**
 * "Servidor: http://…:3000 · Cambiar" en el login. Permite que un mismo APK funcione en la
 * red de quien lo prueba. Solo se muestra sin sesión abierta, así los tokens de un servidor
 * nunca se envían a otro.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { apiUrl, cambiarServidor, probarServidor } from '../lib/config';
import { Boton, Campo } from './componentes';
import { color, radio } from './tema';

type Prueba = { estado: 'probando' } | { estado: 'ok' } | { estado: 'falla'; texto: string } | null;

export function ServidorEditable() {
  const [url, setUrl] = useState(apiUrl);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(url);
  const [prueba, setPrueba] = useState<Prueba>(null);

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
    if (ok) setEditando(false);
  }

  return (
    <View style={e.caja}>
      <View style={e.fila}>
        <View style={{ flex: 1 }}>
          <Text style={e.etiqueta}>SERVIDOR</Text>
          <Text style={e.url} numberOfLines={1}>{url}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => { setEditando((v) => !v); setTexto(url); setPrueba(null); }} hitSlop={10}>
          <Text style={e.cambiar}>{editando ? 'Cerrar' : 'Cambiar'}</Text>
        </Pressable>
      </View>
      {editando ? (
        <View style={{ gap: 10, marginTop: 10 }}>
          <Campo
            etiqueta="Dirección de la API (IP de la máquina con Docker)"
            value={texto}
            onChangeText={setTexto}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.50:3000"
            onSubmitEditing={guardar}
          />
          <Boton texto="Guardar y probar" variante="secundario" onPress={guardar} cargando={prueba?.estado === 'probando'} />
        </View>
      ) : null}
      {prueba?.estado === 'ok' ? <Text style={[e.resultado, { color: color.exito }]}>✓ Conectado</Text> : null}
      {prueba?.estado === 'falla' ? <Text style={[e.resultado, { color: color.error }]}>{prueba.texto}</Text> : null}
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
});
