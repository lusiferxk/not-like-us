/**
 * src/routes/admin/products.js
 * Admin CRUD routes for product management.
 * All routes require the requireAdmin middleware.
 *
 * Routes:
 *   GET    /api/v1/admin/products          — list products (paginated)
 *   GET    /api/v1/admin/products/:id      — get single product
 *   POST   /api/v1/admin/products          — create product
 *   PUT    /api/v1/admin/products/:id      — update product
 *   DELETE /api/v1/admin/products/:id      — delete product
 */
import { Router } from 'express';
import { z }      from 'zod';
import { query }  from '../../config/db.js';
import { requireAdmin }  from '../../middleware/auth.js';
import { validate }      from '../../middleware/validate.js';
import { parsePagination } from '../../utils/helpers.js';
import logger            from '../../utils/logger.js';

const router = Router();

// Apply admin guard to all routes in this module
router.use(requireAdmin);

// ─── Validators ───────────────────────────────────────────────────────────────

const createProductSchema = z.object({
  name:        z.string().min(2).max(200).trim(),
  slug:        z.string().min(2).max(220).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens.'),
  description: z.string().max(5000).optional(),
  price:       z.number().positive(),
  stock:       z.number().int().min(0).default(0),
  category:    z.string().max(100).optional(),
  imageUrl:    z.string().url().optional(),
  visibility:  z.enum(['active', 'hidden', 'out_of_stock']).default('active'),
});

const updateProductSchema = createProductSchema.partial();

// ─── GET /api/v1/admin/products ───────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { visibility, category, search } = req.query;

    const conditions = [];
    const params     = [];
    let   paramIdx   = 1;

    if (visibility) {
      conditions.push(`p.visibility = $${paramIdx++}`);
      params.push(visibility);
    }
    if (category) {
      conditions.push(`p.category ILIKE $${paramIdx++}`);
      params.push(`%${category}%`);
    }
    if (search) {
      conditions.push(`(p.name ILIKE $${paramIdx} OR p.slug ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [{ rows: products }, { rows: countRows }] = await Promise.all([
      query(
        `SELECT * FROM products p ${whereClause} ORDER BY p.created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      ),
      query(`SELECT COUNT(*) FROM products p ${whereClause}`, params),
    ]);

    return res.json({
      success: true,
      data:    products,
      pagination: {
        page,
        limit,
        total:      parseInt(countRows[0].count, 10),
        totalPages: Math.ceil(parseInt(countRows[0].count, 10) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v1/admin/products/:id ──────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/v1/admin/products ─────────────────────────────────────────────
router.post('/', validate(createProductSchema), async (req, res, next) => {
  try {
    const { name, slug, description, price, stock, category, imageUrl, visibility } = req.body;

    const { rows } = await query(
      `INSERT INTO products (name, slug, description, price, stock, category, image_url, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, slug, description, price, stock, category, imageUrl, visibility],
    );

    logger.info({ msg: 'Product created', productId: rows[0].id, name });
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      // Unique constraint violation (slug duplicate)
      return res.status(409).json({ success: false, error: 'A product with this slug already exists.' });
    }
    next(err);
  }
});

// ─── PUT /api/v1/admin/products/:id ──────────────────────────────────────────
router.put('/:id', validate(updateProductSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const fields  = req.body;

    // Build dynamic SET clause
    const setClauses = [];
    const params     = [];
    let   idx        = 1;

    const fieldMap = {
      name: 'name', slug: 'slug', description: 'description',
      price: 'price', stock: 'stock', category: 'category',
      imageUrl: 'image_url', visibility: 'visibility',
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if (fields[key] !== undefined) {
        setClauses.push(`${col} = $${idx++}`);
        params.push(fields[key]);
      }
    }

    if (!setClauses.length) {
      return res.status(400).json({ success: false, error: 'No fields to update.' });
    }

    params.push(id);
    const { rows } = await query(
      `UPDATE products SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }

    logger.info({ msg: 'Product updated', productId: id });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'Slug already taken by another product.' });
    }
    next(err);
  }
});

// ─── DELETE /api/v1/admin/products/:id ───────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      'DELETE FROM products WHERE id = $1 RETURNING id, name',
      [req.params.id],
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }

    logger.info({ msg: 'Product deleted', productId: rows[0].id, name: rows[0].name });
    return res.json({ success: true, message: `Product "${rows[0].name}" deleted.` });
  } catch (err) {
    if (err.code === '23503') {
      // Foreign key: product referenced in order_items
      return res.status(409).json({
        success: false,
        error:   'Cannot delete a product that is referenced by existing orders.',
      });
    }
    next(err);
  }
});

export default router;
