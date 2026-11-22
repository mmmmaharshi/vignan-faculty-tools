# 01 — Delivery mechanism on PWA

Type: research
Status: resolved
Blocked by:
Spec: `.scratch/morning-timetable-notify/map.md`

## Question

What can actually deliver a 7 AM timetable notification for an installed PWA on the faculty's real devices: Notification API from an open/closed app, Push API via service worker, or Periodic Background Sync? What survives app-closed, what needs a push service and VAPID keys, and what are the iOS/Android limits on body size and actions?

## Answer

Push API plus `showNotification()` is the only 7 AM-capable path: a 7 AM server send wakes the installed PWA even with the app closed. The Notification API alone only displays and cannot wake anything; Periodic Background Sync is browser-timed, Chromium-only, and cannot promise 7 AM. iOS needs 16.4+, Home-Screen install, a tap-gated permission, and every push must show a notification; Safari renders no actions so body-tap must open the timetable. Payloads stay under ~4KB. Server needs one VAPID pair, a per-device subscription store with 404/410 cleanup, and a 7 AM sender. Full notes: `C:\Users\manoh\AppData\Local\Temp\opencode\ecap-01-delivery-mechanism.md`.
