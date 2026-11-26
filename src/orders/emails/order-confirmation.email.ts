import { Order } from '../entities/order.entity';

export interface OrderConfirmationEmail {
  subject: string;
  html: string;
  text: string;
}

export interface OrderConfirmationOptions {
  storeName: string;
  // Link to the storefront's confirmation page for this order.
  orderUrl: string;
}

// Storefront colors (e-commerce-store src/constants/colors.js).
export const COLORS = {
  header: '#ece8de',
  ink: '#2d3440',
  card: '#e4ddd2',
  footer: '#2c3b4e',
  muted: '#5c5c5c',
  discount: '#a5492d',
  page: '#f6f4ef',
  white: '#ffffff',
};

// Shown next to a line with a "buy one, get one 50% off" saving, so
// "Qty 2 × $363.00" next to a lower line total isn't confusing.
const DEAL_LABEL = '2nd 50% off';

// Email clients can't load the storefront's web fonts, so use fallbacks
// that exist everywhere.
export const SERIF =
  "Baskerville, 'Libre Baskerville', Georgia, 'Times New Roman', serif";
export const SANS =
  "Montserrat, 'Helvetica Neue', Helvetica, Arial, sans-serif";

// Builds the order confirmation as one HTML page (table layout + inline
// CSS, which is what Gmail and Outlook render reliably) and a plain-text
// copy. Pure function: needs the order with its items loaded.
export function buildOrderConfirmationEmail(
  order: Order,
  { storeName, orderUrl }: OrderConfirmationOptions,
): OrderConfirmationEmail {
  const money = moneyFormatter(order.currency);
  const date = formatDate(order.createdAt);
  const subject = `Order #${order.orderNumber} confirmed – ${storeName}`;

  return {
    subject,
    html: renderHtml(order, { storeName, orderUrl, subject, money, date }),
    text: renderText(order, { storeName, orderUrl, money, date }),
  };
}

interface RenderContext {
  storeName: string;
  orderUrl: string;
  money: (cents: number) => string;
  date: string;
}

function renderHtml(
  order: Order,
  ctx: RenderContext & { subject: string },
): string {
  const { storeName, orderUrl, money, date, subject } = ctx;
  const e = escapeHtml;

  const itemRows = order.items
    .map(
      (item) => `
              <tr>
                <td style="padding:14px 0;border-bottom:1px solid ${COLORS.card};font-family:${SANS};font-size:14px;color:${COLORS.ink};">
                  <strong>${e(item.name)}</strong><br>
                  <span style="color:${COLORS.muted};font-size:13px;">Qty ${item.quantity} × ${money(item.unitPrice)}${item.dealDiscount > 0 ? ` · ${DEAL_LABEL}` : ''}</span>
                </td>
                <td align="right" style="padding:14px 0;border-bottom:1px solid ${COLORS.card};font-family:${SANS};font-size:14px;color:${COLORS.ink};white-space:nowrap;vertical-align:top;">
                  ${money(item.lineTotal)}
                </td>
              </tr>`,
    )
    .join('');

  const discountRow =
    order.discountAmount > 0
      ? summaryRow(
          `Discount${order.discountCode ? ` (${e(order.discountCode)})` : ''}`,
          `−${money(order.discountAmount)}`,
          COLORS.discount,
        )
      : '';
  const paidLocally = paidLocallyText(order);

  const shipping = order.shipping > 0 ? money(order.shipping) : 'Free';
  const address = addressLines(order).map(e).join('<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${e(subject)}</title>
<style>
  body { margin:0; padding:0; background:${COLORS.page}; }
  a { color:${COLORS.ink}; }
  @media (max-width: 620px) {
    .container { width:100% !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
    .title { font-size:24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};">
  <!-- Preview text shown next to the subject in the inbox -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Thanks for your order #${order.orderNumber}. Total ${money(order.total)}.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${COLORS.white};border-radius:8px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="center" style="background:${COLORS.header};padding:28px 20px;">
              <span style="font-family:${SERIF};font-size:26px;letter-spacing:4px;color:${COLORS.ink};text-transform:uppercase;">${e(storeName)}</span>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td class="pad" style="padding:36px 40px 8px;">
              <h1 class="title" style="margin:0 0 12px;font-family:${SERIF};font-size:28px;font-weight:normal;color:${COLORS.ink};">
                Thank you, ${e(order.firstName)}!
              </h1>
              <p style="margin:0 0 6px;font-family:${SANS};font-size:15px;line-height:24px;color:${COLORS.ink};">
                Your payment was successful and your order <strong>#${order.orderNumber}</strong> is confirmed.
                We'll let you know when it's on its way.
              </p>
              <p style="margin:0;font-family:${SANS};font-size:13px;color:${COLORS.muted};">Order date: ${e(date)}</p>
            </td>
          </tr>

          <!-- Items -->
          <tr>
            <td class="pad" style="padding:24px 40px 0;">
              <h2 style="margin:0 0 4px;font-family:${SERIF};font-size:18px;font-weight:normal;color:${COLORS.ink};">Order summary</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${itemRows}
              </table>
            </td>
          </tr>

          <!-- Totals -->
          <tr>
            <td class="pad" style="padding:12px 40px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${summaryRow('Subtotal', money(order.subtotal))}
                ${discountRow}
                ${summaryRow('Shipping', shipping)}
                <tr>
                  <td style="padding:14px 0 0;border-top:2px solid ${COLORS.ink};font-family:${SANS};font-size:16px;font-weight:bold;color:${COLORS.ink};">Total</td>
                  <td align="right" style="padding:14px 0 0;border-top:2px solid ${COLORS.ink};font-family:${SANS};font-size:16px;font-weight:bold;color:${COLORS.ink};white-space:nowrap;">${money(order.total)}</td>
                </tr>
                ${paidLocally ? summaryRow('Paid in your currency', e(paidLocally), COLORS.muted) : ''}
              </table>
            </td>
          </tr>

          <!-- Delivery address -->
          <tr>
            <td class="pad" style="padding:32px 40px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};border-radius:6px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <h2 style="margin:0 0 8px;font-family:${SERIF};font-size:16px;font-weight:normal;color:${COLORS.ink};">Delivery address</h2>
                    <p style="margin:0;font-family:${SANS};font-size:14px;line-height:22px;color:${COLORS.ink};">${address}</p>
                    <p style="margin:10px 0 0;font-family:${SANS};font-size:13px;color:${COLORS.muted};">Standard Shipping</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Button -->
          <tr>
            <td align="center" class="pad" style="padding:32px 40px 40px;">
              <a href="${e(orderUrl)}" style="display:inline-block;background:${COLORS.ink};color:${COLORS.white};font-family:${SANS};font-size:14px;font-weight:bold;letter-spacing:1px;text-decoration:none;text-transform:uppercase;padding:14px 32px;border-radius:4px;">View your order</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="background:${COLORS.footer};padding:24px 20px;">
              <p style="margin:0 0 6px;font-family:${SANS};font-size:13px;color:${COLORS.white};">Questions about your order? Just reply to this email.</p>
              <p style="margin:0;font-family:${SANS};font-size:12px;color:${COLORS.header};">© ${new Date().getUTCFullYear()} ${e(storeName)}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function summaryRow(
  label: string,
  value: string,
  color = COLORS.ink,
): string {
  return `<tr>
                  <td style="padding:6px 0;font-family:${SANS};font-size:14px;color:${color};">${label}</td>
                  <td align="right" style="padding:6px 0;font-family:${SANS};font-size:14px;color:${color};white-space:nowrap;">${value}</td>
                </tr>`;
}

function renderText(order: Order, ctx: RenderContext): string {
  const { storeName, orderUrl, money, date } = ctx;
  const lines = [
    `Thank you, ${order.firstName}!`,
    '',
    `Your payment was successful and your order #${order.orderNumber} is confirmed.`,
    `Order date: ${date}`,
    '',
    'ORDER SUMMARY',
    ...order.items.map(
      (item) =>
        `${item.name} x ${item.quantity}${item.dealDiscount > 0 ? ` (${DEAL_LABEL})` : ''}  ${money(item.lineTotal)}`,
    ),
    '',
    `Subtotal: ${money(order.subtotal)}`,
  ];
  if (order.discountAmount > 0) {
    const code = order.discountCode ? ` (${order.discountCode})` : '';
    lines.push(`Discount${code}: -${money(order.discountAmount)}`);
  }
  lines.push(
    `Shipping: ${order.shipping > 0 ? money(order.shipping) : 'Free'}`,
    `Total: ${money(order.total)}`,
  );
  const paidLocally = paidLocallyText(order);
  if (paidLocally) {
    lines.push(`Paid in your currency: ${paidLocally}`);
  }
  lines.push(
    '',
    'DELIVERY ADDRESS',
    ...addressLines(order),
    '',
    `View your order: ${orderUrl}`,
    '',
    `Questions about your order? Just reply to this email.`,
    storeName,
  );
  return lines.join('\n');
}

export function addressLines(order: Order): string[] {
  return [
    `${order.firstName} ${order.lastName}`,
    order.address,
    order.apartment,
    [order.city, order.postalCode].filter(Boolean).join(' '),
    order.country,
    order.phone,
  ].filter((line): line is string => Boolean(line));
}

// Stripe amounts are in the currency's smallest unit. Most currencies have
// 2 decimals; these differ (https://docs.stripe.com/currencies). ISK and UGX
// are sent with 2 decimals by Stripe, so they are not listed. Check the docs
// page if a new currency shows a wrong amount (display only).
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]); // prettier-ignore
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

function minorUnitDivisor(code: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 1;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 1000;
  return 100;
}

// Amounts are stored in the smallest unit; dividing here is for display only.
export function moneyFormatter(currency: string): (amount: number) => string {
  const code = currency.toUpperCase();
  const format = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
  });
  const divisor = minorUnitDivisor(code);
  return (amount) => format.format(amount / divisor);
}

// "Paid PKR 101,234.00" line, only when Stripe converted the payment
// (Adaptive Pricing); null otherwise.
export function paidLocallyText(order: Order): string | null {
  if (order.presentmentAmount === null || !order.presentmentCurrency) {
    return null;
  }
  return moneyFormatter(order.presentmentCurrency)(order.presentmentAmount);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(date);
}

// Customer input (names, address) goes into HTML: escape it so nobody can
// inject markup or links through the checkout form.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
