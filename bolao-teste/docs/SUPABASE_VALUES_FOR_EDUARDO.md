# Supabase values prefilled

Project ref detected from screenshot:

```text
cmhqkkfczotdnssupkni
```

Project URL filled in `js/config.js`:

```text
https://cmhqkkfczotdnssupkni.supabase.co
```

## Still needed

The publishable key in the screenshot is truncated, so it was **not** inserted.

Go to Supabase → Settings → API Keys → Publishable key → click the copy icon.

Then in `js/config.js`, replace:

```js
anonKey: "PASTE_FULL_SUPABASE_PUBLISHABLE_KEY_HERE",
```

with the full copied key.

Finally change:

```js
enabled: false,
```

to:

```js
enabled: true,
```

Do **not** use the Secret key in the website.
