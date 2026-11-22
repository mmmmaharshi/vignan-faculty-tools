# 02 — The 7 AM source under ADR 0024

Type: grilling
Status: ready-for-agent
Blocked by: 01
Spec: `.scratch/morning-timetable-notify/map.md`

## Question

Given the server holds no ECAP credential and cannot read the Portal without a browser request, where does the 7 AM timetable come from: the previous day's cached read shown at 7 AM, a morning fetch while the app runs, or reopening the stateless-session decision so the server can read ECAP on a schedule?
