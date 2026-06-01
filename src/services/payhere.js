/**
 * src/services/payhere.js
 * PayHere IPG integration utilities.
 *
 * PayHere MD5 signature algorithm:
 *   1. Hash the merchant secret:  secretHash = MD5(MERCHANT_SECRET).toUpperCase()
 *   2. Build the signature input:  input = merchant_id + order_id + amount + currency + status_code + secretHash
 *   3. Final sig:                 MD5(input).toUpperCase()
 *
 * Reference: https://support.payhere.lk/api-&-mobile-sdk/payhere-checkout#3-implementing-server-side-validation
 */
import { md5, formatAmount } from '../utils/helpers.js';
import 'dotenv/config';

const MERCHANT_ID     = process.env.PAYHERE_MERCHANT_ID;
const MERCHANT_SECRET = process.env.PAYHERE_MERCHANT_SECRET;
const CURRENCY        = process.env.PAYHERE_CURRENCY || 'LKR';
const PAYHERE_ENV     = process.env.PAYHERE_ENV || 'sandbox';

/**
 * Returns the correct PayHere checkout base URL based on environment.
 */
export function getPayHereBaseUrl() {
  return PAYHERE_ENV === 'production'
    ? 'https://www.payhere.lk/pay/checkout'
    : 'https://sandbox.payhere.lk/pay/checkout';
}

/**
 * Generate the MD5 hash used in PayHere checkout form (hash field).
 * This is sent TO PayHere when initiating payment.
 *
 * @param {string} orderId   — Unique order identifier (tracking_id)
 * @param {number} amount    — Total order amount
 * @param {string} currency  — Currency code (e.g. 'LKR')
 */
export function generatePayHereHash(orderId, amount, currency = CURRENCY) {
  const secretHash    = md5(MERCHANT_SECRET);
  const amountFormatted = formatAmount(amount);
  const input         = `${MERCHANT_ID}${orderId}${amountFormatted}${currency}${secretHash}`;
  return md5(input);
}

/**
 * Build the complete PayHere IPG parameter set for a new payment.
 * These parameters are returned to the frontend to construct the checkout form.
 *
 * @param {object} order — Order record from the database
 * @param {object} order.tracking_id
 * @param {object} order.total_amount
 * @param {object} order.customer_name
 * @param {object} order.customer_email
 * @param {object} order.customer_phone
 * @param {object} order.shipping_address
 * @param {object} order.city
 * @param {object} order.country
 */
export function buildPayHereParams(order) {
  const hash = generatePayHereHash(order.tracking_id, order.total_amount, order.currency || CURRENCY);

  return {
    sandbox:          PAYHERE_ENV !== 'production' ? 1 : 0,
    merchant_id:      MERCHANT_ID,
    return_url:       process.env.PAYHERE_RETURN_URL   || 'https://example.com/order/success',
    cancel_url:       process.env.PAYHERE_CANCEL_URL   || 'https://example.com/order/cancel',
    notify_url:       process.env.PAYHERE_NOTIFY_URL   || 'https://api.example.com/api/v1/payments/notify',
    order_id:         order.tracking_id,
    items:            'Order Items',
    currency:         order.currency || CURRENCY,
    amount:           formatAmount(order.total_amount),
    first_name:       order.customer_name.split(' ')[0] || order.customer_name,
    last_name:        order.customer_name.split(' ').slice(1).join(' ') || '-',
    email:            order.customer_email,
    phone:            order.customer_phone || '0000000000',
    address:          order.shipping_address,
    city:             order.city || 'Colombo',
    country:          order.country || 'Sri Lanka',
    hash,
  };
}

/**
 * Verify the MD5 signature received in a PayHere async notification.
 * Returns true if the signature matches, false otherwise.
 *
 * @param {object} payload — Raw PayHere webhook body
 */
export function verifyPayHereSignature(payload) {
  const { merchant_id, order_id, payhere_amount, payhere_currency, status_code, md5sig } = payload;

  if (!merchant_id || !order_id || !payhere_amount || !payhere_currency || !status_code || !md5sig) {
    return false;
  }

  const secretHash    = md5(MERCHANT_SECRET);
  const input         = `${merchant_id}${order_id}${payhere_amount}${payhere_currency}${status_code}${secretHash}`;
  const expectedSig   = md5(input);

  return expectedSig === md5sig.toUpperCase();
}
