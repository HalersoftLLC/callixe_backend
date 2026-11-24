import { Order } from '../entities/order.entity';
import {
  addressLines,
  COLORS,
  escapeHtml,
  moneyFormatter,
  SANS,
  SERIF,
  summaryRow,
} from './order-confirmation.email';

export interface OrderShippedEmail {
  subject: string;
  html: string;
  text: string;
}

// "Your order is on its way": sent when the admin marks an order shipped
// (and again on "Resend"). Same look as the confirmation email: table layout
// + inline CSS, plus a plain-text copy. Pure function: needs the order with
// its items loaded.
export function buildOrderShippedEmail(
  order: Order,
  { storeName }: { storeName: string },
): OrderShippedEmail {
  const money = moneyFormatter(order.currency);
  const subject = `Your order #${order.orderNumber} is on its way – ${storeName}`;
  return {
    subject,
    html: renderHtml(order, storeName, subject, money),
    text: renderText(order, storeName, money),
  };
}

function renderHtml(
  order: Order,
  storeName: string,
  subject: string,
  money: (cents: number) => string,
): string {
  const e = escapeHtml;

  const itemRows = order.items
    .map(
      (item) => `
              <tr>
                <td style="padding:14px 0;border-bottom:1px solid ${COLORS.card};font-family:${SANS};font-size:14px;color:${COLORS.ink};">
                  <strong>${e(item.name)}</strong><br>
                  <span style="color:${COLORS.muted};font-size:13px;">Qty ${item.quantity}</span>
                </td>
                <td align="right" style="padding:14px 0;border-bottom:1px solid ${COLORS.card};font-family:${SANS};font-size:14px;color:${COLORS.ink};white-space:nowrap;vertical-align:top;">
                  ${money(item.lineTotal)}
                </td>
              </tr>`,
    )
    .join('');

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
    Your order #${order.orderNumber} has been dispatched and will reach you soon.
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
                Your order is on its way!
              </h1>
              <p style="margin:0;font-family:${SANS};font-size:15px;line-height:24px;color:${COLORS.ink};">
                Hi ${e(order.firstName)}, good news: your order <strong>#${order.orderNumber}</strong>
                has been dispatched from our store and handed to our delivery partner.
                It will reach you soon.
              </p>
            </td>
          </tr>

          <!-- Items -->
          <tr>
            <td class="pad" style="padding:24px 40px 0;">
              <h2 style="margin:0 0 4px;font-family:${SERIF};font-size:18px;font-weight:normal;color:${COLORS.ink};">In this parcel</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${itemRows}
              </table>
            </td>
          </tr>

          <!-- Total -->
          <tr>
            <td class="pad" style="padding:12px 40px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${summaryRow('Total paid', money(order.total))}
              </table>
            </td>
          </tr>

          <!-- Delivery address -->
          <tr>
            <td class="pad" style="padding:32px 40px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};border-radius:6px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <h2 style="margin:0 0 8px;font-family:${SERIF};font-size:16px;font-weight:normal;color:${COLORS.ink};">Delivering to</h2>
                    <p style="margin:0;font-family:${SANS};font-size:14px;line-height:22px;color:${COLORS.ink};">${address}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="background:${COLORS.footer};padding:24px 20px;">
              <p style="margin:0 0 6px;font-family:${SANS};font-size:13px;color:${COLORS.white};">Questions about your delivery? Just reply to this email.</p>
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

function renderText(
  order: Order,
  storeName: string,
  money: (cents: number) => string,
): string {
  return [
    'Your order is on its way!',
    '',
    `Hi ${order.firstName}, good news: your order #${order.orderNumber} has been dispatched from our store and handed to our delivery partner. It will reach you soon.`,
    '',
    'IN THIS PARCEL',
    ...order.items.map((item) => `${item.name} x ${item.quantity}`),
    '',
    `Total paid: ${money(order.total)}`,
    '',
    'DELIVERING TO',
    ...addressLines(order),
    '',
    'Questions about your delivery? Just reply to this email.',
    storeName,
  ].join('\n');
}
