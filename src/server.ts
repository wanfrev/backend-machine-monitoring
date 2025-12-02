import fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

// Creamos el servidor
const server = fastify({ logger: true });

// --- TIPADO (La magia de TypeScript) ---
// Definimos exactamente qué esperamos recibir de la Raspberry Pi
interface GolpeBody {
  maquina_id: string;
  evento: 'moneda' | 'golpe' | 'encendido'; // Solo permitimos estos 3 valores exactos
  valor: number;
}

// Simulamos Base de Datos en memoria
interface Registro extends GolpeBody {
  fecha: Date;
}
const baseDeDatos: Registro[] = [];

// --- CONFIGURACIÓN ---
const start = async () => {
  try {
    // 1. Registrar Plugins
    await server.register(cors, { origin: true });

    // 2. Definir Rutas
    
    // RUTA POST: Recibe datos. 
    // Fíjate en <{ Body: GolpeBody }>. Esto nos da autocompletado y seguridad.
    server.post<{ Body: GolpeBody }>('/api/registro', async (request, reply) => {
      const { maquina_id, evento, valor } = request.body;

      const nuevoRegistro: Registro = {
        maquina_id,
        evento,
        valor,
        fecha: new Date()
      };

      baseDeDatos.push(nuevoRegistro);
      
      request.log.info(`Dato recibido de ${maquina_id}`);
      return { status: 'ok', guardado: true };
    });

    // RUTA GET: Dashboard
    server.get('/api/dashboard', async (request, reply) => {
      const totalMonedas = baseDeDatos.filter(d => d.evento === 'moneda').length;
      return {
        total_monedas: totalMonedas,
        ultimos_eventos: baseDeDatos.slice(-5)
      };
    });

    // 3. Arrancar
    await server.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Servidor TypeScript corriendo en puerto 3000 🚀');

  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
