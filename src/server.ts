import app from "./app";
import dotenv from "dotenv";
import { pool } from "./db";

dotenv.config();

const PORT = process.env.PORT || 3000;

// Verificar conexión a PostgreSQL al iniciar
pool
  .query("SELECT 1")
  .then(() => console.log("✅ Conexión a PostgreSQL exitosa"))
  .catch((err: unknown) =>
    console.error("❌ Error de conexión a PostgreSQL:", err)
  );

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
