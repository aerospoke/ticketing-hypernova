/**
 * Ventana que aparece cuando el staff toca "Sincronizar" sin red. Sin ella, el intento fallido
 * pasa desapercibido. Deja claro lo importante en la puerta: el escáner sigue validando sin
 * red y nada se pierde.
 */
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Boton } from './componentes';
import { color, espacio, radio } from './tema';

export function AvisoSinRed({ visible, pendientes, cerrar, enTurno = true }: { visible: boolean; pendientes: number; cerrar: () => void; enTurno?: boolean }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cerrar} statusBarTranslucent>
      <View style={e.fondo}>
        <View style={e.ventana} accessibilityRole="alert">
          <View style={e.icono}>
            <Text style={{ fontSize: 34 }}>✈️</Text>
          </View>
          <Text style={e.titulo}>Estás sin conexión</Text>
          {enTurno ? (
            <Text style={e.texto}>
              <Text style={{ fontWeight: '900', color: color.exito }}>Puedes seguir escaneando: </Text>
              el escáner valida las entradas en este teléfono, sin red. Si sale VÁLIDA, la persona puede ingresar.
            </Text>
          ) : null}
          <View style={e.caja}>
            <Text style={e.cajaTexto}>
              {pendientes > 0
                ? `${pendientes} escaneo(s) guardados en este teléfono; no se pierden. ${enTurno ? 'Se suben solos cuando vuelva la red.' : 'Vuelve a tocar Sincronizar cuando tengas red.'}`
                : 'No hay escaneos pendientes de subir.'}
            </Text>
          </View>
          <Boton texto={enTurno ? 'Entendido, seguir escaneando' : 'Entendido'} onPress={cerrar} />
        </View>
      </View>
    </Modal>
  );
}

const e = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(18,13,31,0.6)', justifyContent: 'center', padding: espacio.l },
  ventana: { backgroundColor: color.tarjeta, borderRadius: radio.l, padding: espacio.l, gap: 14, alignItems: 'stretch' },
  icono: { alignSelf: 'center', width: 76, height: 76, borderRadius: 38, backgroundColor: '#fff4e5', alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 24, fontWeight: '900', color: color.texto, textAlign: 'center', letterSpacing: -0.5 },
  texto: { fontSize: 16, lineHeight: 23, color: color.texto, textAlign: 'center' },
  caja: { backgroundColor: color.fondo, borderRadius: radio.s, padding: 14 },
  cajaTexto: { fontSize: 14, lineHeight: 20, color: color.suave, textAlign: 'center' },
});
