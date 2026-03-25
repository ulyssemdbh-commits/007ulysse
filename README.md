# Project Configuration

## Database Configuration

The application uses environment variables to configure the database connection. These variables are defined in a `.env` file located at the root of the project. Ensure that the `.env` file is not exposed publicly and is included in `.gitignore`.

### Required Environment Variables

- `DB_HOST`: The hostname of the database server.
- `DB_PORT`: The port number for the database server.
- `DB_USER`: The username for database authentication.
- `DB_PASSWORD`: The password for database authentication.
- `DB_NAME`: The name of the database.

### Validation

Environment variables are validated using [Joi](https://joi.dev/). If any variable is missing or invalid, the application will throw an error during startup.

### Security Best Practices

1. **Do not commit `.env` files to version control**: Add `.env` to `.gitignore`.
2. **Use a secrets management tool for production**: Consider using tools like AWS Secrets Manager, HashiCorp Vault, or Azure Key Vault.
3. **Restrict access to `.env` files**: Ensure that only authorized personnel can access these files.

### Example `.env` File

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=admin
DB_PASSWORD=securepassword
DB_NAME=mydatabase
```

Ensure that the values in the `.env` file match your database configuration.