/**
 * src/middleware/validate.js
 * Zod schema validation middleware factory.
 * Returns an Express middleware that validates req.body against the provided schema.
 * On failure, returns 422 with detailed field-level error messages.
 */
import { ZodError } from 'zod';

/**
 * @param {import('zod').ZodSchema} schema — Zod schema to validate against
 * @param {'body' | 'query' | 'params'} [source='body'] — Request property to validate
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field:   e.path.join('.'),
        message: e.message,
      }));

      return res.status(422).json({
        success: false,
        error:   'Validation failed.',
        details: errors,
      });
    }

    // Replace req[source] with the parsed/coerced Zod output
    req[source] = result.data;
    next();
  };
}
