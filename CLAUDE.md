# MYRA Platform — notes for Claude

## Email
- Every email about MYRA goes out from a myraassistant.co.uk address, through Resend (`sendStudioEmail` in `src/lib/studio/email.ts`). Member-facing mail is sent as `MYRA <myra@myraassistant.co.uk>` with replies to chloe@myraassistant.co.uk.
- Never send MYRA mail from chloe@beforetheshoot.co.uk or any other personal or Before the Shoot account, including test sends. Previews go through the admin routes under `/api/studio/` (for example `/api/studio/welcome-email?to=`), which use the live Resend key on Vercel.
