import { accountError, accountJson, emailField, readAccountJson, textField } from "@/lib/accountApi";
import { resolveRequestSession } from "@/lib/accountSession";
import { AccountStoreError, createOperatorInvitation } from "@/lib/accountStore";
import { publicOrigin } from "@/lib/publicOrigin";
import { sendOperatorInvitationEmail } from "@/services/operatorInvitationEmail";
import { smtpMailConfigured } from "@/services/smtpMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How the setup link reached the invitee; the link itself is always returned as the manual fallback. */
export type InviteDelivery = "email" | "link" | "link_after_mail_failure";

export async function POST(request: Request) {
  const parsed = await readAccountJson(request);
  if (parsed.denied) return parsed.denied;
  const session = await resolveRequestSession(request, "admin");
  if (!session || session.account.role !== "super_admin") return accountError("access_denied", 403);
  const body = parsed.body as Record<string, unknown> | null;
  const name = textField(body?.name, 60);
  const email = emailField(body?.email);
  if (!name || !email) return accountError("invalid_request", 400);
  try {
    const invitation = await createOperatorInvitation({ name, email, invitedBy: session.account.id });
    const setupUrl = `${publicOrigin(request)}/admin/accept?token=${encodeURIComponent(invitation.token)}`;
    let delivery: InviteDelivery = "link";
    if (smtpMailConfigured()) {
      try {
        await sendOperatorInvitationEmail({ to: email, name, invitedBy: session.account.name, setupUrl, expiresAt: invitation.expiresAt });
        delivery = "email";
      } catch {
        delivery = "link_after_mail_failure";
      }
    }
    return accountJson({
      ok: true,
      delivery,
      ...(delivery === "email" ? { sentTo: email } : {}),
      setupUrl,
      expiresAt: invitation.expiresAt,
    }, 201);
  } catch (error) {
    if (error instanceof AccountStoreError) return accountError(error.code, 409);
    return accountError("internal_error", 500);
  }
}
