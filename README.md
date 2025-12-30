# account
Fintech Dashboard Site Template

## Local demo backend (register/login/send points)
This repo includes a **tiny local Node.js server** (no dependencies) that serves the static UI and provides minimal APIs for:
- Register
- Login / logout (cookie session)
- Check “me” (email + points)
- Send points to another registered user

Run:

```bash
cd /Users/radoslav.sharapanov/account
npm run dev
```

Then open `http://127.0.0.1:8787`.

Local data is stored in `data/users.json` (created on first run).

Note: this is **for local/dev only**, not production-grade security.
## Features
- Keyboard-accessible, with skip to main content button
- Respects the no-animation preference
- Screen reader support
- More UI alignment
- Seamless loading and switching between Desktop and Mobile
- Semantic simple clean HTML
- Usable without CSS and JavaScript
- Ample link hit area
- Phone notch support
- Apple Watch support
- Proper footer links separator (doesn’t appear at end of line)
- Buttons ripple effect
- Unbreakable layout with any amount of content
- Dynamic translation
- Right to left writing support
- Themes with dark option
- Local fonts, avoiding the Google Fonts privacy hazard
- No dependencies
- 0 issues in [Wave](https://wave.webaim.org/report#/account.rado.bg)
- 0 issues in [axe®](https://www.deque.com/axe/)
- 100% [Lighthouse](https://pagespeed.web.dev/report?url=https%3A%2F%2Faccount.rado.bg%2F) score
- Following best practices taught by the world’s top web specialists
