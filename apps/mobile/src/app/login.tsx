import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { iniciarSesion, mensajeDeError } from '../lib/api';
import { Aviso, Boton, Campo, s } from '../ui/componentes';
import { ServidorEditable } from '../ui/servidor';
import { Icono } from '../ui/icono';
import { FOTOS, Portada } from '../ui/portada';
import { color, espacio, radio } from '../ui/tema';
import { useBarraClara } from '../ui/barra';

/** Mismo ritmo que el carrusel de la web: alguien que mira 10 s alcanza a ver varias fotos. */
const CADA_MS = 2200;

export default function Login() {
  useBarraClara();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actual, setActual] = useState(0);
  const { height } = useWindowDimensions();
  const arriba = useSafeAreaInsets().top;

  useEffect(() => {
    const t = setTimeout(() => setActual((i) => (i + 1) % FOTOS.length), CADA_MS);
    return () => clearTimeout(t);
  }, [actual]);

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

  const foto = FOTOS[actual];
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.noche }} behavior="padding">
      <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <Portada foto={foto} alto={Math.max(320, height * 0.46)} transicion={500} hasta={0.92}>
          <View style={[e.marca, { top: arriba + 14 }]}>
            <View style={e.logo}>
              <Icono nombre="boleto" tam={22} tinte="#fff" />
            </View>
            <Text style={e.marcaTexto}>Ticketing</Text>
          </View>
          <View style={e.sobreFoto}>
            <Text style={e.enVivo}>EN VIVO</Text>
            <Text style={e.artista}>{foto.artista}</Text>
            <Text style={e.detalle}>{foto.detalle}</Text>
            <View style={e.puntos}>
              {FOTOS.map((f, i) => (
                <View key={f.artista} style={[e.puntoCarrusel, i === actual && e.puntoActivo]} />
              ))}
            </View>
          </View>
        </Portada>

        <View style={e.hoja}>
          <Text style={e.titular}>Tu próxima noche{'\n'}empieza aquí.</Text>
          <Text style={s.suave}>Compra, guarda y muestra tus entradas, incluso sin señal. Si eres staff, entra con tu cuenta para escanear.</Text>
          <View style={{ gap: espacio.m, marginTop: espacio.s }}>
            <Campo etiqueta="Correo" placeholder="tu@correo.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
            <Campo etiqueta="Contraseña" placeholder="••••••••••" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={entrar} />
            {error ? <Aviso texto={error} tipo="error" /> : null}
            <Boton texto="Entrar" onPress={entrar} cargando={cargando} deshabilitado={!email || !password} />
          </View>
          <Link href="/registro" style={e.enlace}>
            ¿No tienes cuenta? <Text style={{ fontWeight: '800' }}>Regístrate</Text>
          </Link>
          <ServidorEditable />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const e = StyleSheet.create({
  marca: { position: 'absolute', left: espacio.l, flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 38, height: 38, borderRadius: 12, backgroundColor: color.primario, alignItems: 'center', justifyContent: 'center' },
  marcaTexto: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  sobreFoto: { position: 'absolute', left: espacio.l, right: espacio.l, bottom: 52 },
  enVivo: { color: color.acento, fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  artista: { color: '#fff', fontSize: 40, fontWeight: '900', letterSpacing: -1, marginTop: 2 },
  detalle: { color: 'rgba(255,255,255,0.8)', fontSize: 15, marginTop: 2 },
  puntos: { flexDirection: 'row', gap: 6, marginTop: 14 },
  puntoCarrusel: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  puntoActivo: { width: 24, backgroundColor: '#fff' },
  hoja: { flex: 1, marginTop: -28, backgroundColor: color.tarjeta, borderTopLeftRadius: radio.l + 8, borderTopRightRadius: radio.l + 8, padding: espacio.l, paddingTop: espacio.xl, gap: espacio.s, paddingBottom: 40 },
  titular: { fontSize: 28, lineHeight: 32, fontWeight: '900', color: color.texto, letterSpacing: -0.8 },
  enlace: { color: color.primario, textAlign: 'center', padding: 14, fontSize: 15 },
});
