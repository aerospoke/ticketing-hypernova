import '../lib/polyfill';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { migrar } from '../lib/db';
import { cargarSesion } from '../lib/sesion';
import { useSesion } from '../lib/usar';
import { color } from '../ui/tema';

void SplashScreen.preventAutoHideAsync();
// Arranque rápido: la base local se migra una vez y la sesión se lee del Keychain.
migrar();
void cargarSesion();

export default function Raiz() {
  const { cargada } = useSesion();
  useEffect(() => {
    if (cargada) void SplashScreen.hideAsync();
  }, [cargada]);

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTintColor: color.primario,
          headerTitleStyle: { color: color.texto, fontWeight: '800' },
          headerStyle: { backgroundColor: color.fondo },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: color.fondo },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(asistente)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="registro" options={{ title: '', headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerTintColor: '#fff' }} />
        <Stack.Screen name="evento/[id]" options={{ title: 'Evento' }} />
        <Stack.Screen name="reserva/[id]" options={{ title: 'Tu reserva', headerBackVisible: false }} />
        <Stack.Screen name="entrada/[id]" options={{ title: 'Entrada' }} />
        <Stack.Screen name="escaner/index" options={{ headerShown: false }} />
        <Stack.Screen name="escaner/evento" options={{ title: '' }} />
        <Stack.Screen name="escaner/camara" options={{ title: 'Escanear', headerShown: false }} />
        <Stack.Screen name="escaner/resumen" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack>
    </>
  );
}
