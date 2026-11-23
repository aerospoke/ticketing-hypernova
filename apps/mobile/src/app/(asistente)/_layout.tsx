import { Redirect, Tabs } from 'expo-router';
import { type ColorValue, Text } from 'react-native';
import { useSesion } from '../../lib/usar';
import { color } from '../../ui/tema';

const icono = (simbolo: string) => ({ color: c }: { color: ColorValue }) => <Text style={{ color: c, fontSize: 18 }}>{simbolo}</Text>;

export default function TabsAsistente() {
  const { sesion, cargada } = useSesion();
  if (cargada && !sesion) return <Redirect href="/login" />;
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: color.primario, headerTitleStyle: { color: color.texto } }}>
      <Tabs.Screen name="index" options={{ title: 'Cartelera', tabBarIcon: icono('◎') }} />
      <Tabs.Screen name="billetera" options={{ title: 'Mis entradas', tabBarIcon: icono('▣') }} />
      <Tabs.Screen name="cuenta" options={{ title: 'Cuenta', tabBarIcon: icono('☰') }} />
    </Tabs>
  );
}
