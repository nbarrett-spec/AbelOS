# Template: Order Confirmation

**Trigger:** Builder submits an order
**Sends to:** Builder primary contact + PO contact (if different)

## Subject
Order {{order_number}} confirmed — {{order_date}}

## Body (plain)

{{builder_contact_first_name}},

We got your order. Here's the summary:

Order #: {{order_number}}
PO #: {{po_number}}
Date: {{order_date}}
Total: ${{order_total}}
Target delivery: {{delivery_date}}
Ship to: {{delivery_address}}

View full details:
{{order_link}}

Next steps on our side:
- Materials lock T-48 hours before delivery
- Load confirmation T-24
- You'll get a ship notice when the truck rolls

If anything on the order is off, reply or call {{staff_contact_name}} at {{staff_contact_phone}}. Faster to catch it now than after it ships.

— Abel Lumber
{{abel_phone}}

## Body (HTML)

<p>{{builder_contact_first_name}},</p>

<p>We got your order. Here's the summary:</p>

<table cellpadding="6" style="border-collapse:collapse;">
  <tr><td><strong>Order #</strong></td><td>{{order_number}}</td></tr>
  <tr><td><strong>PO #</strong></td><td>{{po_number}}</td></tr>
  <tr><td><strong>Date</strong></td><td>{{order_date}}</td></tr>
  <tr><td><strong>Total</strong></td><td>${{order_total}}</td></tr>
  <tr><td><strong>Target delivery</strong></td><td>{{delivery_date}}</td></tr>
  <tr><td><strong>Ship to</strong></td><td>{{delivery_address}}</td></tr>
</table>

<p><a href="{{order_link}}" style="background:#1F4E79;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">View full order</a></p>

<p><strong>Next steps on our side:</strong></p>
<ul>
  <li>Materials lock T-48 hours before delivery</li>
  <li>Load confirmation T-24</li>
  <li>You'll get a ship notice when the truck rolls</li>
</ul>

<p>If anything on the order is off, reply or call {{staff_contact_name}} at {{staff_contact_phone}}. Faster to catch it now than after it ships.</p>

<p>— Abel Lumber<br/>{{abel_phone}}</p>
