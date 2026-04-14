# Template: Invoice

**Trigger:** Order marked DELIVERED; invoice generated
**Sends to:** Builder AP contact + primary contact

## Subject
Invoice {{invoice_number}} — {{builder_company}} — due {{invoice_due_date}}

## Body (plain)

{{builder_contact_first_name}},

Invoice for order {{order_number}} is attached.

Invoice #: {{invoice_number}}
Total: ${{invoice_total}}
Due: {{invoice_due_date}}
Terms: {{payment_terms}}

View and pay online:
{{invoice_link}}

Checks mail to:
Abel Lumber
[Mailing address — TODO: fill in]
Dallas, TX

Questions on the invoice? {{staff_contact_name}} or accounting@abellumber.com.

— Abel Lumber
{{abel_phone}}

## Body (HTML)

<p>{{builder_contact_first_name}},</p>

<p>Invoice for order <strong>{{order_number}}</strong> is attached.</p>

<table cellpadding="6" style="border-collapse:collapse;">
  <tr><td><strong>Invoice #</strong></td><td>{{invoice_number}}</td></tr>
  <tr><td><strong>Total</strong></td><td>${{invoice_total}}</td></tr>
  <tr><td><strong>Due</strong></td><td>{{invoice_due_date}}</td></tr>
  <tr><td><strong>Terms</strong></td><td>{{payment_terms}}</td></tr>
</table>

<p><a href="{{invoice_link}}" style="background:#1F4E79;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">View and pay online</a></p>

<p>Checks mail to:<br/>
Abel Lumber<br/>
[Mailing address — TODO: fill in]<br/>
Dallas, TX</p>

<p>Questions on the invoice? {{staff_contact_name}} or <a href="mailto:accounting@abellumber.com">accounting@abellumber.com</a>.</p>

<p>— Abel Lumber<br/>{{abel_phone}}</p>
