const dotenv = require('dotenv');
const Joi = require('joi');

// Load environment variables from .env file
dotenv.config();

// Define schema for environment variable validation
const envSchema = Joi.object({
  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().integer().min(1).max(65535).required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required()
}).unknown();

// Validate environment variables
const { error, value: envVars } = envSchema.validate(process.env);
if (error) {
  throw new Error(`Environment variable validation error: ${error.message}`);
}

// Database configuration
const databaseConfig = {
  host: envVars.DB_HOST,
  port: envVars.DB_PORT,
  user: envVars.DB_USER,
  password: envVars.DB_PASSWORD,
  database: envVars.DB_NAME
};

module.exports = databaseConfig;