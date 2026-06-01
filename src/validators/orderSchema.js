/**
 * src/validators/orderSchema.js
 * Zod schema for POST /api/v1/orders request body.
 * Validates shipping data and the cart items array.
 */
import { z } from 'zod';

const cartItemSchema = z.object({
  productId:   z.string().uuid({ message: 'productId must be a valid UUID.' }),
  productName: z.string().min(1).max(200),
  unitPrice:   z.number().positive({ message: 'unitPrice must be a positive number.' }),
  quantity:    z.number().int().positive({ message: 'quantity must be a positive integer.' }),
});

export const orderSchema = z.object({
  // Customer contact
  customerName:    z.string().min(2).max(120).trim(),
  customerEmail:   z.string().email({ message: 'A valid email address is required.' }).max(120),
  customerPhone:   z.string().max(30).optional(),

  // Shipping details
  shippingAddress: z.string().min(5).max(500).trim(),
  city:            z.string().max(80).optional(),
  country:         z.string().length(2, { message: 'country must be a 2-letter ISO code (e.g. LK).' }).default('LK'),

  // Order currency
  currency:        z.enum(['LKR', 'USD', 'EUR', 'GBP', 'AUD']).default('LKR'),

  // Cart items — must contain at least one item
  items: z
    .array(cartItemSchema)
    .min(1, { message: 'Cart must contain at least one item.' })
    .max(50,  { message: 'Cart cannot exceed 50 distinct line items.' }),

  // Optional buyer notes
  notes: z.string().max(500).optional(),
});
