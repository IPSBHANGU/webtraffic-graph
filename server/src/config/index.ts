export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL!,
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000").split(","),
};

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable");
}
