# Template: Ship Notice

**Trigger:** Order status changes to SHIPPED / DELIVERED
**Sends to:** Builder primary contact + job site contact

## Subject
Order {{order_number}} is on the way — ETA {{delivery_date}}

## Body (plain)

{{builder_contact_first_name}},

Order {{order_number}} left our yard.

Carrier: {{carrier}}
Tracking: {{tracking_number}}
ETA: {{delivery_date}}
Delivering to: {{delivery_address}}

Track live:
{{order_link}}

If your receiving window changed or you need a reschedule, call {{staff_contact_name}} ASAP at {{staff_contact_phone}}.

— Abel Lumber
{{abel_phone}}

## Body (HTML)

<p>{{builder_contact_first_name}},</p>

<p>Order <strong>{{order_number}}</strong> left our yard.</p>

<table cellpadding="6" style="border-collapse:collapse;">
  <tr><td><strong>Carrier</strong></td><td>{{carrier}}</td></tr>
  <tr><td><strong>Tracking</strong></td><td>{{tracking_number}}</td></tr>
  <tr><td><strong>ETA</strong></td><td>{{delivery_date}}</td></tr>
  <tr><td><strong>Delivering to</strong></td><td>{{delivery_address}}</td></tr>
</table>

<p><a href="{{order_link}}" style="background:#1F4E79;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">Track live</a></p>

<p>If your receiving window changed or you need a reschedule, call {{staff_contact_name}} ASAP at {{staff_contact_phone}}.</p>

<p>— Abel Lumber<br/>{{abel_phone}}</p>
