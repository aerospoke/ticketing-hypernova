import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorApi, mensajeDeError, registrarse } from '../lib/api';
import { Aviso, Boton, Campo, s } from '../ui/componentes';
import { Icono, type NombreIcono } from '../ui/icono';
import { Degradado } from '../ui/portada';
import { color, espacio, radio } from '../ui/tema';
import { useBarraClara } from '../ui/barra';

export default function Registro() {
  useBarraClara();
  const arriba = useSafeAreaInsets().top;
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    setCargando(true);
    setError(null);
    try {
      await registrarse(nombre, email, password);
      router.replace('/(asistente)');
    } catch (e) {
      // Los errores de validación traen el detalle por campo.
      if (e instanceof ErrorApi && e.codigo === 'peticion_invalida' && Array.isArray(e.detalles)) {
        const campos = (e.detalles as { campo: string }[]).map((d) => d.campo).join(', ');
        setError(`Revisa: ${campos}. La contraseña necesita al menos 10 caracteres.`);
      } else setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.pantalla} behavior="padding">
      <ScrollView contentContainerStyle={[s.contenido, { paddingTop: 0, paddingHorizontal: 0 }]} keyboardShouldPersistTaps="handled">
        {/* Sin foto de un artista: al usuario nuevo se le cuenta qué gana con la cuenta. */}
        <View style={[e.cabecera, { paddingTop: arriba + 64 }]}>
          <Degradado desde={0} hasta={0.6} tono={color.primario2} inicio="0%" />
          <View style={e.logo}>
            <Icono nombre="boleto" tam={30} tinte="#fff" />
          </View>
          <Text style={e.titulo}>Crea tu cuenta</Text>
          <Text style={e.subtitulo}>En un minuto y sin tarjeta.</Text>
          <View style={{ gap: 10, marginTop: espacio.m }}>
            <Beneficio icono="estrella" texto="Compra en segundos, con el precio congelado al reservar" />
            <Beneficio icono="boleto" texto="Tu entrada funciona aunque no tengas señal" />
            <Beneficio icono="listo" texto="Transfiérela a un amigo si no puedes ir" />
          </View>
        </View>
        <View style={{ paddingHorizontal: espacio.l, gap: espacio.m, paddingTop: espacio.s }}>
          <Campo etiqueta="Nombre" placeholder="Como aparece en tu documento" value={nombre} onChangeText={setNombre} autoComplete="name" />
          <Campo etiqueta="Correo" placeholder="tu@correo.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Campo etiqueta="Contraseña (mínimo 10 caracteres)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
          {error ? <Aviso texto={error} tipo="error" /> : null}
          <Boton texto="Crear cuenta" onPress={crear} cargando={cargando} deshabilitado={!nombre || !email || password.length < 10} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Beneficio({ icono, texto }: { icono: NombreIcono; texto: string }) {
  return (
    <View style={e.beneficio}>
      <View style={e.beneficioIcono}>
        <Icono nombre={icono} tam={18} tinte="#fff" />
      </View>
      <Text style={e.beneficioTexto}>{texto}</Text>
    </View>
  );
}

const e = StyleSheet.create({
  cabecera: { backgroundColor: color.primario, paddingHorizontal: espacio.l, paddingBottom: espacio.xl, overflow: 'hidden', borderBottomLeftRadius: radio.l, borderBottomRightRadius: radio.l },
  logo: { width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  titulo: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -1, marginTop: 14 },
  subtitulo: { color: 'rgba(255,255,255,0.8)', fontSize: 15 },
  beneficio: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  beneficioIcono: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  beneficioTexto: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
});
