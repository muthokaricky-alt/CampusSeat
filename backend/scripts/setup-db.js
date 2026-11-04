
import 'dotenv/config';
import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import path from 'node:path';

const schemaPath = path.resolve('database/schema_hosted.sql');

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : undefined,
  multipleStatements: true
});

try {
  const schema = await fs.readFile(schemaPath, 'utf8');

  console.log('Connected to Aiven!');
  console.log('Creating CampusSeat tables...');

  await connection.query(schema);

  console.log('SUCCESS: Database schema imported!');
} catch (error) {
  console.error('Database setup failed:', error.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
