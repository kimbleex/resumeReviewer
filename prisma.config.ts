import { config as loadDotenv } from "dotenv";
import { defineConfig, env } from "prisma/config";

loadDotenv({ path: ".env.dev", override: false });
loadDotenv({ override: false });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
