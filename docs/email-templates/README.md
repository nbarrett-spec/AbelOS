# Abel OS Email Templates

6 templates covering the core builder/ops communication flows. Each has:
- **Subject** line with mergetags
- **Body (plain text)** — render as default
- **Body (HTML)** — optional rich version

Mergetags use `{{ }}` syntax. Replace these in code:
- `{{builder_name}}`, `{{builder_contact_first_name}}`, `{{builder_company}}`
- `{{order_number}}`, `{{order_total}}`, `{{order_date}}`, `{{po_number}}`
- `{{invoice_number}}`, `{{invoice_total}}`, `{{invoice_due_date}}`, `{{invoice_days_overdue}}`
- `{{delivery_date}}`, `{{delivery_address}}`, `{{carrier}}`, `{{tracking_number}}`
- `{{reset_link}}`, `{{login_link}}`, `{{invoice_link}}`, `{{order_link}}`
- `{{abel_phone}}` = (214) 555-0100, `{{abel_email}}` = ops@abellumber.com
- `{{staff_contact_name}}`, `{{staff_contact_email}}`, `{{staff_contact_phone}}`

Voice: direct, practical, no-fluff. Write like the CEO of a door distributor, not a SaaS company.
