import { Redirect } from 'expo-router';
import { useSesion } from '../lib/usar';
import { Cargando } from '../ui/componentes';

/** Punto de entrada: según la sesión y el rol, a login, a la app del asistente o al escáner. */
export default function Inicio() {
  const { sesion, cargada } = useSesion();
  if (!cargada) return <Cargando />;
  if (!sesion) return <Redirect href="/login" />;
  if (sesion.usuario.rol === 'staff') return <Redirect href="/escaner" />;
  return <Redirect href="/(asistente)" />;
}
