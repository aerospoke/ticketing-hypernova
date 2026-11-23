/**
 * Portadas de los eventos: las mismas fotos y la misma asignación que el portal web
 * (apps/admin/src/carrusel.ts), así un evento se ve igual en el teléfono y en la web.
 * Las fotos van dentro de la app: funcionan sin internet.
 */
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export interface Foto {
  fuente: number;
  artista: string;
  detalle: string;
  /** Qué parte de la foto queda visible al recortarla. */
  foco: { top: string; left: string };
}

export const FOTOS: Foto[] = [
  { fuente: require('../../assets/portadas/01.jpg'), artista: 'Shakira', detalle: 'Las Mujeres Ya No Lloran', foco: { left: '45%', top: '25%' } },
  { fuente: require('../../assets/portadas/02.jpg'), artista: 'Drake', detalle: 'En vivo · Arena', foco: { left: '50%', top: '25%' } },
  { fuente: require('../../assets/portadas/03.jpg'), artista: 'Karol G', detalle: 'Carnaval · Escenario principal', foco: { left: '50%', top: '35%' } },
  { fuente: require('../../assets/portadas/04.jpg'), artista: 'The Weeknd', detalle: 'After Hours til Dawn', foco: { left: '50%', top: '35%' } },
  { fuente: require('../../assets/portadas/05.jpg'), artista: 'Sandra Sandoval', detalle: 'Rebeldía Tour', foco: { left: '48%', top: '30%' } },
  { fuente: require('../../assets/portadas/06.jpg'), artista: 'Nando Boom', detalle: 'Reggae en español', foco: { left: '50%', top: '30%' } },
];

/** Misma fórmula que la web: hash multiplicativo de Knuth para que ids cercanos no repitan foto. */
export function fotoDe(eventoId: string | number): Foto {
  const mezcla = Math.imul(Number(eventoId), 2654435761) >>> 0;
  return FOTOS[mezcla % FOTOS.length];
}

/** Degradado vertical (transparente → oscuro) para que el texto sobre la foto se lea. */
export function Degradado({ desde = 0, hasta = 0.85, tono = '#120d1f', inicio = '35%' }: { desde?: number; hasta?: number; tono?: string; inicio?: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tono} stopOpacity={desde} />
          <Stop offset={inicio} stopColor={tono} stopOpacity={desde} />
          <Stop offset="1" stopColor={tono} stopOpacity={hasta} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#g)" />
    </Svg>
  );
}

/** Foto de portada con degradado y contenido encima (abajo a la izquierda). */
export function Portada({
  foto, alto, children, estilo, transicion = 0, hasta,
}: { foto: Foto; alto: number; children?: ReactNode; estilo?: ViewStyle; transicion?: number; hasta?: number }) {
  return (
    <View style={[{ height: alto, overflow: 'hidden', backgroundColor: '#120d1f' }, estilo]}>
      <Image source={foto.fuente} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={foto.foco} transition={transicion} />
      <Degradado hasta={hasta} />
      {children}
    </View>
  );
}
