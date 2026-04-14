# Template: Past-Due Notice

**Trigger:** Invoice unpaid N days past due (7d / 15d / 30d escalation)
**Sends to:** Builder AP contact + primary contact; CC accounting on 15d+

## Subject
Invoice {{invoice_number}} — {{invoice_days_overdue}} days past due

## Body (plain)

{{builder_contact_first_name}},

Invoice {{invoice_number}} is {{invoice_days_overdue}} days past due.

Amount owed: ${{invoice_total}}
Original due date: {{invoice_due_date}}

Pay now:
{{invoice_link}}

If there's a dispute on the invoice or the delivery, tell me today so we can sort it out before this escalates. Otherwise, our contract calls for {{payment_terms}} — we'd like to keep that on track.

If payment is already on the way, reply with the check # or ACH reference and we'll update the account.

— {{staff_contact_name}}
Accounting, Abel Lumber
{{staff_contact_phone}}
accounting@abellumber.com

## Body (HTML)

<p>{{builder_contact_first_name}},</p>

<p>Invoice <strong>{{invoice_number}}</strong> is <strong>{{invoice_days_overdue}} days past due</strong>.</p>

<table cellpadding="6" style="border-collapse:collapse;">
  <tr><td><strong>Amount owed</strong></td><td>${{invoice_total}}</td></tr>
  <tr><td><strong>Original due date</strong></td><td>{{invoice_due_date}}</td></tr>
</table>

<p><a href="{{invoice_link}}" style="background:#C00000;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">Pay now</a></p>

<p>If there's a dispute on the invoice or the delivery, tell me today so we can sort it out before this escalates. Otherwise, our contract calls for <strong>{{payment_terms}}</strong> — we'd like to keep that on track.</p>

<p>If payment is already on the way, reply with the check # or ACH reference and we'll update the account.</p>

<p>— {{staff_contact_name}}<br/>Accounting, Abel Lumber<br/>{{staff_contact_phone}}<br/><a href="mailto:accounting@abellumber.com">accounting@abellumber.com</a></p>
