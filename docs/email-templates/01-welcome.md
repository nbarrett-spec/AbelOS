# Template: Welcome / Account Activation

**Trigger:** New Builder account created in Abel OS
**Sends to:** Builder primary contact email

## Subject
Welcome to Abel OS, {{builder_contact_first_name}} — set up your account

## Body (plain)

{{builder_contact_first_name}},

You've been set up on Abel OS, our order, pricing, and delivery portal for {{builder_company}}.

Click below to set your password:
{{reset_link}}

Once you're in, you can:
- Place and track orders against your contract pricing
- Access your standard plan packages
- See delivery schedules and ship confirmations
- Review invoices and payment status

The link expires in 48 hours. If it's expired by the time you get to it, reply to this email and we'll send a new one.

Questions? {{staff_contact_name}} is your account manager — reach {{staff_contact_first_name}} directly at {{staff_contact_phone}} or {{staff_contact_email}}.

— Nate Barrett
CEO, Abel Lumber
{{abel_phone}}

## Body (HTML)

<p>{{builder_contact_first_name}},</p>

<p>You've been set up on Abel OS, our order, pricing, and delivery portal for <strong>{{builder_company}}</strong>.</p>

<p><a href="{{reset_link}}" style="background:#1F4E79;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;">Set your password</a></p>

<p>Once you're in, you can:</p>
<ul>
  <li>Place and track orders against your contract pricing</li>
  <li>Access your standard plan packages</li>
  <li>See delivery schedules and ship confirmations</li>
  <li>Review invoices and payment status</li>
</ul>

<p><em>The link expires in 48 hours. If it's expired by the time you get to it, reply to this email and we'll send a new one.</em></p>

<p>Questions? {{staff_contact_name}} is your account manager — reach {{staff_contact_first_name}} directly at {{staff_contact_phone}} or <a href="mailto:{{staff_contact_email}}">{{staff_contact_email}}</a>.</p>

<p>— Nate Barrett<br/>CEO, Abel Lumber<br/>{{abel_phone}}</p>
