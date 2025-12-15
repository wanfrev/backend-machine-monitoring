import { User } from "../../models/types";

declare module "express-serve-static-core" {
  interface Request {
    user?: User & { zone?: string; role?: string };
  }
}
