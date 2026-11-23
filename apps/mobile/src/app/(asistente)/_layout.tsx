import { Redirect, Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { useSesion } from '../../lib/usar';
import { Icono } from '../../ui/icono';
import { color } from '../../ui/tema';

/** Ícono de la pestaña Cuenta: la inicial del usuario en un círculo. */
function Avatar({ inicial, activo }: { inicial: string; activo: boolean }) {
  return (
    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: activo ? color.primario : color.borde, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: activo ? '#fff' : color.suave, fontWeight: '800', fontSize: 13 }}>{inicial}</Text>
    </View>
  );
}

export default function TabsAsistente() {
  const { sesion, cargada } = useSesion();
  if (cargada && !sesion) return <Redirect href="/login" />;
  const inicial = (sesion?.usuario.nombre ?? '?').trim().charAt(0).toUpperCase();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.primario,
        tabBarInactiveTintColor: color.suave,
        tabBarLabelStyle: { fontWeight: '700', fontSize: 12 },
        tabBarStyle: { borderTopColor: color.borde, backgroundColor: color.tarjeta, paddingTop: 6 },
        sceneStyle: { backgroundColor: color.fondo },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Cartelera', tabBarIcon: ({ focused }) => <Icono nombre="estrella" tam={26} estilo={{ opacity: focused ? 1 : 0.45 }} /> }} />
      <Tabs.Screen name="billetera" options={{ title: 'Mis entradas', tabBarIcon: ({ focused }) => <Icono nombre="boleto" tam={26} estilo={{ opacity: focused ? 1 : 0.45 }} /> }} />
      <Tabs.Screen name="cuenta" options={{ title: 'Cuenta', tabBarIcon: ({ focused }) => <Avatar inicial={inicial} activo={focused} /> }} />
    </Tabs>
  );
}
