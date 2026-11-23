import { Image, type ImageStyle } from 'react-native';

/** Íconos de Icons8 (crédito en el README). `tinte` los pinta de un color sólido. */
const FUENTES = {
  boleto: require('../../assets/iconos/boleto.png'),
  estrella: require('../../assets/iconos/estrella.png'),
  agregar: require('../../assets/iconos/agregar.png'),
  listo: require('../../assets/iconos/listo.png'),
  cerrar: require('../../assets/iconos/cerrar.png'),
} as const;

export type NombreIcono = keyof typeof FUENTES;

export function Icono({ nombre, tam = 24, tinte, estilo }: { nombre: NombreIcono; tam?: number; tinte?: string; estilo?: ImageStyle }) {
  return (
    <Image
      source={FUENTES[nombre]}
      style={[{ width: tam, height: tam }, tinte ? { tintColor: tinte } : null, estilo]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
