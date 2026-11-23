import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback } from 'react';

/**
 * Barra de estado (hora, batería) en blanco mientras la pantalla tiene una foto u otro fondo
 * oscuro arriba. Se hace al enfocar y no con <StatusBar>, porque las pestañas quedan montadas
 * y el último <StatusBar> montado ganaría aunque su pantalla no esté visible.
 */
export function useBarraClara() {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );
}
