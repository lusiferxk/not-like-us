/**
 * src/validators/paymentSchema.js
 * Zod schema for POST /api/v1/payments/notify (PayHere IPG webhook).
 * All fields mirror the PayHere asynchronous notification payload spec.
 */
import { z } from 'zod';

export const paymentNotifySchema = z.object({
  merchant_id:       z.string().min(1),
  order_id:          z.string().min(1),
  payment_id:        z.string().min(1),
  payhere_amount:    z.string().min(1),
  payhere_currency:  z.string().min(1),
  status_code:       z.string().min(1),
  md5sig:            z.string().min(1),

  // Optional fields PayHere may include
  status_message:    z.string().optional(),
  method:            z.string().optional(),
  card_holder_name:  z.string().optional(),
  card_no:           z.string().optional(),
  card_expiry:       z.string().optional(),
  recurring:         z.string().optional(),
  message_type:      z.string().optional(),
  item_recurrence:   z.string().optional(),
  item_duration:     z.string().optional(),
  item_rec_status:   z.string().optional(),
  item_rec_date_next: z.string().optional(),
  item_rec_install_mnt: z.string().optional(),
  custom_1:          z.string().optional(),
  custom_2:          z.string().optional(),
});
