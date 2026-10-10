import 'dotenv/config';
import { bootstrapAdminFromEnvironment, databasePath } from '../db.js';

bootstrapAdminFromEnvironment();
console.log(`SQLite workspace initialized at ${databasePath()}`);
