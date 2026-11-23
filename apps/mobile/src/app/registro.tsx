import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { ErrorApi, mensajeDeError, registrarse } from '../lib/api';
import { Aviso, Boton, Campo, s } from '../ui/componentes';
import { fotoDe, Portada } from '../ui/portada';
import { espacio } from '../ui/tema';
import { useBarraClara } from '../ui/barra';

export default function Registro() {
  useBarraClara();
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
    <KeyboardAvoidingView style={s.pantalla} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.contenido, { paddingTop: 0, paddingHorizontal: 0 }]} keyboardShouldPersistTaps="handled">
        <Portada foto={fotoDe(3)} alto={250} hasta={0.92}>
          <View style={{ position: 'absolute', left: espacio.l, bottom: espacio.l }}>
            <Text style={{ color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.6 }}>Únete a la fila de adelante</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)' }}>Tu cuenta guarda tus entradas y tu historial.</Text>
          </View>
        </Portada>
        <View style={{ paddingHorizontal: espacio.l, gap: espacio.m }}>
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
