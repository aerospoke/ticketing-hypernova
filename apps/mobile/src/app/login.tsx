import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { iniciarSesion, mensajeDeError } from '../lib/api';
import { Aviso, Boton, Campo, s } from '../ui/componentes';
import { Icono } from '../ui/icono';
import { color } from '../ui/tema';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function entrar() {
    setCargando(true);
    setError(null);
    try {
      const u = await iniciarSesion(email, password);
      router.replace(u.rol === 'staff' ? '/escaner' : '/(asistente)');
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.pantalla} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.contenido, { paddingTop: 32 }]} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icono nombre="boleto" tam={40} />
          <Text style={[s.titulo, { fontSize: 26 }]}>Ticketing</Text>
        </View>
        <Text style={s.suave}>Tus entradas, también sin conexión. Si eres staff, entra con tu cuenta para escanear.</Text>
        <Campo etiqueta="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
        <Campo etiqueta="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={entrar} />
        {error ? <Aviso texto={error} tipo="error" /> : null}
        <Boton texto="Entrar" onPress={entrar} cargando={cargando} deshabilitado={!email || !password} />
        <Link href="/registro" style={{ color: color.primario, textAlign: 'center', padding: 8, fontWeight: '600' }}>
          ¿No tienes cuenta? Regístrate
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
