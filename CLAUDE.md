# MYRA Platform — notes for Claude

## Email
- Every email about MYRA goes out from a myraassistant.co.uk address, through Resend (`sendStudioEmail` in `src/lib/studio/email.ts`). Member-facing mail is sent as `MYRA <myra@myraassistant.co.uk>` with replies to chloe@myraassistant.co.uk.
- Never send MYRA mail from chloe@beforetheshoot.co.uk or any other personal or Before the Shoot account, including test sends. Previews go through the admin routes under `/api/studio/` (for example `/api/studio/welcome-email?to=`), which use the live Resend key on Vercel.
- Every member email uses `memberEmailShell` in `src/lib/studio/email.ts`: the MYRA logo, kicker line, white card on grey, silver footer — the same look as the invitation email. Never a one-off layout.
- A picture in an email that has been sent is never renamed or deleted (emails load it from the site each time they are opened). A new picture gets a new file name.
- Before a member send, the exact email that will go out is sent to Chloe as a sample and she approves it. Any send link or scheduled send for an older version is switched off first, so only the approved version can go.
