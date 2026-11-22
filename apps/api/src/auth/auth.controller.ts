import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Publico } from './auth.guard';
import { AuthService } from './auth.service';

// Validación en el borde: lo que no cumple el esquema no llega al servicio.
// El correo se normaliza (sin espacios, minúsculas) ANTES de validarlo: un correo pegado
// con un espacio al final o con mayúsculas es el mismo correo.
const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const Registro = z.object({
  nombre: z.string().trim().min(1).max(200),
  email: Email,
  // Largo mínimo antes que reglas de composición (guía NIST 800-63B).
  password: z.string().min(10).max(128),
});
const Login = z.object({
  email: Email,
  password: z.string().min(1).max(128),
});
const Refresh = z.object({ refresh_token: z.string().min(20).max(200) });

// Rate limiting de autenticación: por IP, más estricto que el global. Se configura por
// variable para poder correr la prueba de carga, que inicia sesión con 200 usuarios.
const LIMITE_AUTH = Number(process.env.AUTH_RATE_LIMIT ?? 10);

@Publico()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('registro')
  @Throttle({ default: { limit: LIMITE_AUTH, ttl: 60_000 } })
  registro(@Body({ schema: Registro }) body: z.infer<typeof Registro>) {
    return this.auth.registrar(body.nombre, body.email, body.password);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: LIMITE_AUTH, ttl: 60_000 } })
  login(@Body({ schema: Login }) body: z.infer<typeof Login>) {
    return this.auth.login(body.email, body.password);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: LIMITE_AUTH * 3, ttl: 60_000 } })
  refresh(@Body({ schema: Refresh }) body: z.infer<typeof Refresh>) {
    return this.auth.refrescar(body.refresh_token);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body({ schema: Refresh }) body: z.infer<typeof Refresh>) {
    await this.auth.logout(body.refresh_token);
  }
}
