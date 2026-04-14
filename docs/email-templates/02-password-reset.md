# Template: Password Reset

**Trigger:** User (builder or staff) requests password reset
**Sends to:** Account email

## Subject
Reset your Abel OS password

## Body (plain)

We got a request to reset the password for this account.

Click below to set a new one:
{{reset_link}}

This link expires in 2 hours. If you didn't request this, ignore the email — your password stays the same.

If something isn't working, reply to this email or call {{abel_phone}}.

— Abel Lumber

## Body (HTML)

<p>We got a request to reset the password for this account.</p>

<p><a href="{{reset_link}}" style="background:#1F4E79;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;">Reset password</a></p>

<p><em>This link expires in 2 hours. If you didn't request this, ignore the email — your password stays the same.</em></p>

<p>If something isn't working, reply to this email or call {{abel_phone}}.</p>

<p>— Abel Lumber</p>
