/**
 * src/services/excelExporter.js
 * Streaming Excel export using ExcelJS WorkbookWriter.
 * Pipes directly to the Express response stream — no in-memory buffering.
 */
import ExcelJS from 'exceljs';

/**
 * Stream an orders export workbook directly to the HTTP response.
 *
 * @param {import('express').Response} res      — Express response object (already headered)
 * @param {object[]}                   orders   — Array of order rows from PostgreSQL
 */
export async function streamOrdersExcel(res, orders) {
  // Set headers before streaming begins
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.xlsx"`);

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream:       res,
    useStyles:    true,
    useSharedStrings: false,
  });

  const sheet = workbook.addWorksheet('Orders');

  // Header row styling
  sheet.columns = [
    { header: 'Tracking ID',      key: 'tracking_id',     width: 22 },
    { header: 'Customer Name',    key: 'customer_name',   width: 24 },
    { header: 'Email',            key: 'customer_email',  width: 30 },
    { header: 'Phone',            key: 'customer_phone',  width: 16 },
    { header: 'Shipping Address', key: 'shipping_address',width: 40 },
    { header: 'City',             key: 'city',            width: 16 },
    { header: 'Country',          key: 'country',         width: 10 },
    { header: 'Total (LKR)',      key: 'total_amount',    width: 14 },
    { header: 'Currency',         key: 'currency',        width: 10 },
    { header: 'Order Status',     key: 'status',          width: 14 },
    { header: 'Payment Status',   key: 'payment_status',  width: 16 },
    { header: 'PayHere Order ID', key: 'payhere_order_id',width: 24 },
    { header: 'Created At',       key: 'created_at',      width: 22 },
  ];

  // Style the header row
  const headerRow = sheet.getRow(1);
  headerRow.font    = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A56DB' } };
  headerRow.height  = 20;
  headerRow.commit();

  // Write each order row
  for (const order of orders) {
    const row = sheet.addRow({
      ...order,
      created_at: order.created_at
        ? new Date(order.created_at).toLocaleString('en-GB')
        : '',
    });
    row.commit();
  }

  await workbook.commit();
}

/**
 * Stream orders as a plain CSV download.
 * Lightweight fallback — no dependency on ExcelJS.
 *
 * @param {import('express').Response} res
 * @param {object[]}                   orders
 */
export function streamOrdersCSV(res, orders) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.csv"`);

  const COLUMNS = [
    'tracking_id', 'customer_name', 'customer_email', 'customer_phone',
    'shipping_address', 'city', 'country', 'total_amount', 'currency',
    'status', 'payment_status', 'payhere_order_id', 'created_at',
  ];

  // Header line
  res.write(COLUMNS.join(',') + '\r\n');

  for (const order of orders) {
    const row = COLUMNS
      .map((col) => {
        const val = order[col] ?? '';
        // Escape commas and quotes in CSV cells
        const str = String(val).replace(/"/g, '""');
        return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
      })
      .join(',');
    res.write(row + '\r\n');
  }

  res.end();
}
