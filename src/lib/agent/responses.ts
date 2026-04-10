// ── Response Generator ────────────────────────────────────────────────────
// Generates formatted responses for each intent, with channel-aware output.
// Used by chat, SMS, and email routes via the shared orchestrator.

import type { Intent } from './intents'
import { formatDate, formatCurrency, statusEmoji, stripMarkdown } from './formatters'

export type Channel = 'PORTAL' | 'SMS' | 'EMAIL'

export interface AgentResponse {
  text: string
  dataRefs: any[]
}

/**
 * Generate a response for the given intent & data.
 * The `channel` param controls output formatting:
 *   PORTAL → rich markdown (bold, bullets, tables, links)
 *   SMS    → plain text, compact (stripped markdown)
 *   EMAIL  → slightly richer plain text, professional tone
 */
export function generateResponse(
  intent: Intent,
  data: any,
  builderName: string,
  channel: Channel = 'PORTAL',
): AgentResponse {
  const raw = generateRawResponse(intent, data, builderName)

  if (channel === 'SMS') {
    return { text: compactForSms(stripMarkdown(raw.text)), dataRefs: raw.dataRefs }
  }
  if (channel === 'EMAIL') {
    return { text: stripMarkdown(raw.text), dataRefs: raw.dataRefs }
  }
  return raw // PORTAL gets rich markdown
}

/** Keep SMS under ~1500 chars by trimming list items */
function compactForSms(text: string): string {
  if (text.length <= 1500) return text
  const lines = text.split('\n')
  const trimmed: string[] = []
  let count = 0
  for (const line of lines) {
    trimmed.push(line)
    count += line.length
    if (count > 1200) {
      trimmed.push('\nReply MORE for the rest, or visit the portal for full details.')
      break
    }
  }
  return trimmed.join('\n')
}

// ── Raw response generator (rich markdown) ───────────────────────────────

function generateRawResponse(intent: Intent, data: any, builderName: string): AgentResponse {
  switch (intent) {
    case 'GREETING':
      return {
        text: `Hi${builderName ? ` ${builderName}` : ''}! I'm your Abel Lumber assistant. I can help you with:\n\n\u2022 **Delivery tracking** \u2014 "Where is my delivery?"\n\u2022 **Schedule changes** \u2014 "Can I reschedule my delivery?"\n\u2022 **Order status** \u2014 "What\u2019s the status of my order?"\n\u2022 **Invoices & billing** \u2014 "What do I owe?"\n\u2022 **Product pricing** \u2014 "How much is a 2068 door?"\n\u2022 **Warranty claims** \u2014 "Check my warranty status"\n\nWhat can I help you with?`,
        dataRefs: [],
      }

    case 'DELIVERY_STATUS':
    case 'DELIVERY_ETA':
    case 'DELIVERY_LIST':
      return generateDeliveryResponse(intent, data)

    case 'SCHEDULE_VIEW':
      return generateScheduleResponse(data)

    case 'SCHEDULE_CHANGE':
      return generateScheduleChangeResponse(data)

    case 'ORDER_STATUS':
      return generateOrderStatusResponse(data)

    case 'ORDER_HISTORY':
      return generateOrderHistoryResponse(data)

    case 'ORDER_DETAIL':
      return generateOrderDetailResponse(data)

    case 'INVOICE_STATUS':
    case 'INVOICE_LIST':
      return generateInvoiceResponse(data)

    case 'PRODUCT_PRICING':
      return generateProductPricingResponse(data)

    case 'PRODUCT_AVAILABILITY':
      return generateProductAvailabilityResponse(data)

    case 'WARRANTY_STATUS':
      return generateWarrantyResponse(data)

    case 'ESCALATE':
      return generateEscalationResponse()

    default:
      return {
        text: `I'm here to help! I can assist with:\n\n\u2022 **Deliveries** \u2014 track status, ETAs, schedule changes\n\u2022 **Orders** \u2014 check status, view history, order details\n\u2022 **Invoices** \u2014 outstanding balances, payment status\n\u2022 **Products** \u2014 pricing, availability\n\u2022 **Warranty** \u2014 claim status\n\nJust ask me a question or tell me what you need!`,
        dataRefs: [],
      }
  }
}

// ── Individual response generators ───────────────────────────────────────

function generateDeliveryResponse(intent: Intent, data: any): AgentResponse {
  if (!data || data.length === 0) {
    return {
      text: `You don't have any active deliveries at the moment. If you're expecting one, your order may still be in production. Would you like me to check your order status instead?`,
      dataRefs: [],
    }
  }
  let text = `Here are your active deliveries:\n\n`
  const refs: any[] = []
  for (const d of data) {
    text += `${statusEmoji(d.status)} **${d.deliveryNumber}**\n`
    text += `   Status: **${d.status.replace(/_/g, ' ')}**\n`
    text += `   Job: ${d.jobNumber} \u2014 ${d.community || d.jobAddress || 'N/A'}${d.lotBlock ? ` (${d.lotBlock})` : ''}\n`
    text += `   Scheduled: ${formatDate(d.scheduledDate)}\n`
    if (d.crewName) text += `   Crew: ${d.crewName}\n`
    if (d.departedAt) text += `   Departed: ${formatDate(d.departedAt)}\n`
    if (d.arrivedAt) text += `   Arrived: ${formatDate(d.arrivedAt)}\n`
    text += '\n'
    refs.push({ type: 'delivery', id: d.id, number: d.deliveryNumber })
  }
  if (intent === 'DELIVERY_ETA') {
    const next = data.find((d: any) => d.status === 'IN_TRANSIT' || d.status === 'SCHEDULED')
    if (next) {
      text += `\n\uD83D\uDD50 Your next delivery (${next.deliveryNumber}) is ${next.status === 'IN_TRANSIT' ? 'currently en route' : `scheduled for **${formatDate(next.scheduledDate)}**`}.`
    }
  }
  return { text, dataRefs: refs }
}

function generateScheduleResponse(data: any): AgentResponse {
  if (!data || data.length === 0) {
    return {
      text: `You don't have any upcoming scheduled events. Would you like me to check your delivery or order status?`,
      dataRefs: [],
    }
  }
  let text = `Here's your upcoming schedule:\n\n`
  for (const se of data) {
    text += `${statusEmoji(se.status)} **${formatDate(se.scheduledDate)}** ${se.scheduledTime || ''}\n`
    text += `   ${se.entryType.replace(/_/g, ' ')}: ${se.title || se.jobNumber}\n`
    text += `   ${se.community || se.jobAddress || ''}${se.lotBlock ? ` (${se.lotBlock})` : ''}\n`
    if (se.crewName) text += `   Crew: ${se.crewName}\n`
    text += '\n'
  }
  return { text, dataRefs: data.map((s: any) => ({ type: 'schedule', id: s.id })) }
}

function generateScheduleChangeResponse(_data: any): AgentResponse {
  return {
    text: `I can help you reschedule! To submit a change request, I need a few details:\n\n1. **Which delivery or job?** (e.g., job number, delivery number, or address)\n2. **What new date would you prefer?**\n3. **Reason for the change** (optional but helps with faster approval)\n\nPlease provide these details and I'll check availability and submit the request. Note: same-week changes are auto-approved if a crew is available; larger changes need staff approval.`,
    dataRefs: [],
  }
}

function generateOrderStatusResponse(data: any): AgentResponse {
  if (!data || data.length === 0) {
    return {
      text: `You don't have any active orders right now. Would you like to browse the catalog or check your order history?`,
      dataRefs: [],
    }
  }
  let text = `Here are your active orders:\n\n`
  for (const o of data) {
    text += `${statusEmoji(o.status)} **${o.orderNumber}** \u2014 ${formatCurrency(Number(o.total))}\n`
    text += `   Status: **${o.status.replace(/_/g, ' ')}** | Payment: ${o.paymentStatus.replace(/_/g, ' ')}\n`
    if (o.deliveryDate) text += `   Delivery: ${formatDate(o.deliveryDate)}\n`
    text += `   ${o.jobCount} job(s) | Placed: ${formatDate(o.createdAt)}\n\n`
  }
  return { text, dataRefs: data.map((o: any) => ({ type: 'order', id: o.id, number: o.orderNumber })) }
}

function generateOrderHistoryResponse(data: any): AgentResponse {
  if (!data || data.length === 0) {
    return { text: `No order history found for your account.`, dataRefs: [] }
  }
  let text = `Your recent orders:\n\n`
  for (const o of data) {
    text += `${statusEmoji(o.status)} **${o.orderNumber}** \u2014 ${formatCurrency(Number(o.total))} \u2014 ${o.status.replace(/_/g, ' ')} \u2014 ${formatDate(o.createdAt)}\n`
  }
  text += `\nWant details on a specific order? Just give me the order number.`
  return { text, dataRefs: data.map((o: any) => ({ type: 'order', id: o.id, number: o.orderNumber })) }
}

function generateOrderDetailResponse(data: any): AgentResponse {
  if (!data) {
    return {
      text: `I couldn't find that order number in your account. Please double-check the number (format: ORD-2026-0001 or SO-123456) and try again.`,
      dataRefs: [],
    }
  }
  let text = `**Order ${data.orderNumber}**\n\n`
  text += `Status: ${statusEmoji(data.status)} **${data.status.replace(/_/g, ' ')}**\n`
  text += `Payment: ${data.paymentStatus.replace(/_/g, ' ')} | Terms: ${data.paymentTerm.replace(/_/g, ' ')}\n`
  text += `Delivery: ${formatDate(data.deliveryDate)}\n\n`
  text += `| Item | Qty | Price | Total |\n|------|-----|-------|-------|\n`
  for (const item of data.items || []) {
    text += `| ${item.description?.substring(0, 40)} | ${item.quantity} | ${formatCurrency(Number(item.unitPrice))} | ${formatCurrency(Number(item.lineTotal))} |\n`
  }
  text += `\n**Subtotal:** ${formatCurrency(Number(data.subtotal))}\n`
  if (Number(data.taxAmount) > 0) text += `**Tax:** ${formatCurrency(Number(data.taxAmount))}\n`
  if (Number(data.shippingCost) > 0) text += `**Shipping:** ${formatCurrency(Number(data.shippingCost))}\n`
  text += `**Total:** ${formatCurrency(Number(data.total))}\n`
  return { text, dataRefs: [{ type: 'order', id: data.id, number: data.orderNumber }] }
}

function generateInvoiceResponse(data: any): AgentResponse {
  if (!data || data.length === 0) {
    return {
      text: `No invoices found for your account. This could mean your orders haven't been invoiced yet.`,
      dataRefs: [],
    }
  }
  const outstanding = data.filter((i: any) => Number(i.balanceDue) > 0)
  const totalDue = outstanding.reduce((sum: number, i: any) => sum + Number(i.balanceDue), 0)
  let text = outstanding.length > 0
    ? `You have **${outstanding.length} outstanding invoice(s)** totaling **${formatCurrency(totalDue)}**.\n\n`
    : `All invoices are paid up! Here are your recent invoices:\n\n`
  for (const i of data.slice(0, 10)) {
    text += `${statusEmoji(i.status)} **${i.invoiceNumber}** \u2014 ${formatCurrency(Number(i.total))}\n`
    text += `   Status: ${i.status} | Due: ${formatDate(i.dueDate)} | Paid: ${formatCurrency(Number(i.amountPaid))}\n\n`
  }
  return { text, dataRefs: data.map((i: any) => ({ type: 'invoice', id: i.id, number: i.invoiceNumber })) }
}

function generateProductPricingResponse(data: any): AgentResponse {
  if (!data || data.length === 0) {
    return {
      text: `I couldn't find matching products. Try searching with a more specific term like "2068 hollow core", a SKU like "BC1234", or a door size. You can also browse the full catalog at /catalog.`,
      dataRefs: [],
    }
  }
  let text = `Here are the matching products with your account pricing:\n\n`
  for (const p of data) {
    text += `**${p.displayName || p.name}** (${p.sku})\n`
    text += `   Category: ${p.category}`
    if (p.doorSize) text += ` | Size: ${p.doorSize}`
    if (p.handing) text += ` | ${p.handing}`
    if (p.material) text += ` | ${p.material}`
    text += `\n`
    text += `   Your Price: **${formatCurrency(Number(p.yourPrice))}**`
    if (p.customPrice) text += ` *(custom account price)*`
    text += `\n\n`
  }
  text += `Want to add any of these to a quote? Visit your [catalog](/catalog) to get started.`
  return { text, dataRefs: data.map((p: any) => ({ type: 'product', id: p.id, sku: p.sku })) }
}

function generateProductAvailabilityResponse(data: any): AgentResponse {
  if (!data || data.length === 0) {
    return {
      text: `I couldn't find that product. Try a product name, SKU, or category. You can also check the full catalog at /catalog.`,
      dataRefs: [],
    }
  }
  let text = `Product availability:\n\n`
  for (const p of data) {
    text += `**${p.displayName || p.name}** (${p.sku}) \u2014 ${p.category}\n`
    if (p.doorSize) text += `   Size: ${p.doorSize}`
    if (p.handing) text += ` | ${p.handing}`
    text += `\n`
    text += `   Price: ${formatCurrency(Number(p.yourPrice))}\n\n`
  }
  text += `For detailed stock levels and lead times, please contact your Abel Lumber rep.`
  return { text, dataRefs: data.map((p: any) => ({ type: 'product', id: p.id })) }
}

function generateWarrantyResponse(data: any): AgentResponse {
  if (!data || data.length === 0) {
    return {
      text: `No warranty claims found for your account. If you need to file a claim, you can do so from your [Warranty page](/dashboard/warranty) or tell me what happened and I'll help get it started.`,
      dataRefs: [],
    }
  }
  let text = `Your warranty claims:\n\n`
  for (const w of data) {
    text += `**${w.claimNumber}** \u2014 ${w.status.replace(/_/g, ' ')}\n`
    text += `   ${w.description?.substring(0, 80) || 'No description'}\n`
    text += `   Job: ${w.jobNumber} | Filed: ${formatDate(w.createdAt)}\n\n`
  }
  return { text, dataRefs: data.map((w: any) => ({ type: 'warranty', id: w.id })) }
}

function generateEscalationResponse(): AgentResponse {
  return {
    text: `I understand you'd like to speak with someone directly. I'm connecting you to your Abel Lumber account representative. They'll be notified and will follow up shortly.\n\nIn the meantime, you can also:\n\u2022 Call us at **(817) 555-ABEL**\n\u2022 Email your rep directly from your account settings\n\nIs there anything specific you'd like me to pass along to them?`,
    dataRefs: [],
  }
}

/**
 * Generate a multi-intent response by combining responses for multiple intents.
 * Primary intent gets the full response, secondary intents get abbreviated summaries.
 */
export function generateMultiIntentResponse(
  intents: Intent[],
  dataMap: Map<Intent, any>,
  builderName: string,
  channel: Channel = 'PORTAL',
): AgentResponse {
  if (intents.length <= 1) {
    return generateResponse(intents[0] || 'GENERAL', dataMap.get(intents[0]) || null, builderName, channel)
  }

  // Primary intent gets full response
  const primary = generateResponse(intents[0], dataMap.get(intents[0]) || null, builderName, channel)
  const allRefs = [...primary.dataRefs]

  // Secondary intents get compact summaries
  for (let i = 1; i < intents.length && i < 3; i++) {
    const secondary = generateResponse(intents[i], dataMap.get(intents[i]) || null, builderName, channel)
    // Take first 3 lines of secondary response as a brief summary
    const brief = secondary.text.split('\n').slice(0, 4).join('\n')
    primary.text += `\n\n---\n\n${brief}`
    allRefs.push(...secondary.dataRefs)
  }

  return { text: primary.text, dataRefs: allRefs }
}
