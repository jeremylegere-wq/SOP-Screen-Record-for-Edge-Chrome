# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's private reporting instead:
the repository's **Security** tab, then **Report a vulnerability**. You'll get a reply as soon as the
maintainer can look at it.

## What the extension can see

Step Recorder runs on every http/https page while a recording is active, takes screenshots of the visible tab,
and stores them locally in the browser (`chrome.storage.local`). It makes no network requests and sends nothing
anywhere. Password and card-like fields are never written into step text and are blurred in screenshots, but
screenshots show whatever else is on screen, so review a guide before sharing it.

## Supported versions

Only the latest release receives fixes.
