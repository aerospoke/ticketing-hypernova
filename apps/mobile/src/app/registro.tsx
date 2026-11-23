import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { ErrorApi, mensajeDeError, registrarse } from '../lib/api';
import { Aviso, Boton, Campo, s } from '../ui/componentes';

export default function Registro() {
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
      <ScrollView contentContainerStyle={s.contenido} keyboardShouldPersistTaps="handled">
        <Campo etiqueta="Nombre" value={nombre} onChangeText={setNombre} autoComplete="name" />
        <Campo etiqueta="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Campo etiqueta="Contraseña (mínimo 10 caracteres)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
        {error ? <Aviso texto={error} tipo="error" /> : null}
        <Boton texto="Crear cuenta" onPress={crear} cargando={cargando} deshabilitado={!nombre || !email || password.length < 10} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
