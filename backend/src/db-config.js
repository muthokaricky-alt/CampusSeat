import 'dotenv/config';

/**
 * Database connection settings, shared by the app and the scripts (migrate, seed).
 * Kept separate from config.js so scripts do not need the app's secrets.
 */
export const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'campusseat_db',
  // Hosted MySQL (Aiven) requires TLS. Set DB_SSL_CA to the CA certificate (PEM) to verify the server.
  ...(process.env.DB_SSL === 'true'
    ? { ssl: process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : { rejectUnauthorized: false } }
    : {}),
  charset: 'utf8mb4',
};

/** Human-readable target, for logs and error messages (no password). */
export const dbTarget = () => `${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`;
