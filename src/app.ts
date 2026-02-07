import express from "express";
import cors from "cors";
import { json } from "body-parser";
import authRoutes from "./routes/authRoutes";
import machineRoutes from "./routes/machineRoutes";
import userRoutes from "./routes/userRoutes";
import iotRoutes from "./routes/iotRoutes";
import pushRoutes from "./routes/pushRoutes";
import coinValueRoutes from "./routes/coinValueRoutes";
import salesRoutes from "./routes/salesRoutes";
import reportsRoutes from "./routes/reportsRoutes";

const app = express();

// Middleware
app.use(cors());
app.use(json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/machines", machineRoutes);
app.use("/api/users", userRoutes);
app.use("/api/iot", iotRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/coin-values", coinValueRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/reports", reportsRoutes);

// Health check
app.get("/", (req, res) => {
  res.send({ status: "ok", message: "Machine Monitoring Backend API" });
});

export default app;
