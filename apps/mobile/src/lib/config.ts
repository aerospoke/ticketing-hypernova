/**
 * URL del backend. Se define al iniciar Expo:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.50:3000 npx expo start
 * - Emulador Android: http://10.0.2.2:3000
 * - Simulador iOS:    http://localhost:3000
 * - Teléfono físico:  http://<IP de tu PC en la LAN>:3000 (API levantada con API_BIND=0.0.0.0)
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
