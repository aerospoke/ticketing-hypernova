import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, cerrarSesion, mensajeDeError } from '../../lib/api';
import { useConsulta, useSesion } from '../../lib/usar';
import { Aviso, Boton, Cargando, ErrorVista, Insignia, s, Tarjeta } from '../../ui/componentes';
import { color, fecha, pesos } from '../../ui/tema';

interface Compra {
  id: string;
  evento: string;
  zona: string;
  cantidad: number;
  monto_centesimos: number;
  reembolsado_centesimos: number;
  estado: 'pagada' | 'reembolsada' | 'reembolso_automatico';
  pagada_en: string;
  entradas: { id: string; estado: string }[];
}
interface Transferencia {
  id: string;
  entrada_id: string;
  estado: 'pendiente' | 'aceptada' | 'cancelada' | 'rechazada';
  direccion: 'enviada' | 'recibida';
  de_email: string;
  a_email: string;
  evento: string;
}

const ESTADO_COMPRA = { pagada: ['Pagada', color.exito], reembolsada: ['Reembolsada', color.alerta], reembolso_automatico: ['Devuelta', color.alerta] } as const;
const ESTADO_TRANSF = { pendiente: color.alerta, aceptada: color.exito, cancelada: color.suave, rechazada: color.error } as const;

export default function Cuenta() {
  const { sesion } = useSesion();
  const { datos, error, cargando, refrescando, recargar } = useConsulta(async () => {
    const [compras, transferencias] = await Promise.all([
      api<{ items: Compra[] }>('/v1/me/compras'),
      api<Transferencia[]>('/v1/me/transferencias'),
    ]);
    return { compras: compras.items, transferencias };
  });
  const [fallo, setFallo] = useState<string | null>(null);

  async function resolver(t: Transferencia, accion: 'aceptar' | 'rechazar' | 'cancelar') {
    setFallo(null);
    try {
      await api(`/v1/transferencias/${t.id}/${accion}`, { metodo: 'POST' });
      void recargar(true);
    } catch (e) {
      setFallo(mensajeDeError(e));
    }
  }

  if (cargando && !datos) return <Cargando />;
  if (error && !datos) return <ErrorVista error={error} reintentar={() => void recargar()} />;

  return (
    <ScrollView style={s.pantalla} contentContainerStyle={s.contenido} refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => void recargar(true)} />}>
      <Tarjeta>
        <Text style={s.subtitulo}>{sesion?.usuario.nombre}</Text>
        <Text style={s.suave}>{sesion?.usuario.email}</Text>
      </Tarjeta>

      <Text style={s.subtitulo}>Transferencias</Text>
      {fallo ? <Aviso tipo="error" texto={fallo} /> : null}
      {datos?.transferencias.length === 0 ? <Text style={s.suave}>No tienes transferencias.</Text> : null}
      {datos?.transferencias.map((t) => (
        <Tarjeta key={t.id}>
          <View style={s.fila}>
            <Text style={[s.texto, { flex: 1 }]}>{t.evento} · #{t.entrada_id}</Text>
            <Insignia texto={t.estado} tono={ESTADO_TRANSF[t.estado]} />
          </View>
          <Text style={s.suave}>{t.direccion === 'recibida' ? `De ${t.de_email}` : `Para ${t.a_email}`}</Text>
          {t.estado === 'pendiente' && t.direccion === 'recibida' ? (
            <View style={[s.fila, { gap: 8 }]}>
              <Boton texto="Aceptar" onPress={() => void resolver(t, 'aceptar')} estilo={{ flex: 1 }} />
              <Boton texto="Rechazar" variante="secundario" onPress={() => void resolver(t, 'rechazar')} estilo={{ flex: 1 }} />
            </View>
          ) : null}
          {t.estado === 'pendiente' && t.direccion === 'enviada' ? (
            <Boton texto="Cancelar transferencia" variante="secundario" onPress={() => void resolver(t, 'cancelar')} />
          ) : null}
        </Tarjeta>
      ))}

      <Text style={s.subtitulo}>Historial de compras</Text>
      {datos?.compras.length === 0 ? <Text style={s.suave}>Todavía no compraste entradas.</Text> : null}
      {datos?.compras.map((c) => (
        <Tarjeta key={c.id}>
          <View style={s.fila}>
            <Text style={[s.texto, { flex: 1 }]}>{c.evento} · {c.zona}</Text>
            <Insignia texto={ESTADO_COMPRA[c.estado][0]} tono={ESTADO_COMPRA[c.estado][1]} />
          </View>
          <Text style={s.suave}>{fecha(c.pagada_en)} · {c.cantidad} entrada(s) · {pesos(c.monto_centesimos)}</Text>
          {c.reembolsado_centesimos > 0 ? <Text style={[s.suave, { color: color.alerta }]}>Reembolsado: {pesos(c.reembolsado_centesimos)}</Text> : null}
          <Text style={s.suave}>{c.entradas.map((e) => `#${e.id} ${e.estado}`).join(' · ')}</Text>
        </Tarjeta>
      ))}

      <Boton texto="Cerrar sesión" variante="secundario" onPress={async () => { await cerrarSesion(); router.replace('/login'); }} />
    </ScrollView>
  );
}
