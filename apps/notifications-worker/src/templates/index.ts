/**
 * Static email templates for the notifications worker.
 *
 * Spec 14 allows V1 templates to be static files as long as template
 * versions remain traceable — these renderers are the V1 "static files"
 * form, keyed by the same `templateKey` strings the calling workers pass
 * to POST /v1/notifications.
 *
 * Every substitution is HTML-escaped before it reaches the html body, so a
 * hostile value in `templateData` (or a recipient-controlled field such as
 * an email hint) can never inject markup. Renderers only read the fields
 * they need; unknown extra fields are ignored, and unknown template keys
 * return null so the provider can fail the send with a bounded reason
 * instead of delivering an empty message.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type TemplateData = Record<string, string | number | boolean | null>;

export interface TemplateRenderOptions {
  /**
   * Product display name used in subjects/footers (e.g. "Chaseid").
   * Falls back to neutral copy when not configured so a misconfigured
   * deployment still produces a sensible email.
   */
  brandName?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Stringify a templateData value; null/undefined render as "". */
function str(data: TemplateData, key: string): string {
  const v = data[key];
  if (v === null || v === undefined) return "";
  return String(v);
}

/**
 * Render an ISO timestamp as a human-readable UTC string. Falls back to the
 * raw value when it does not parse — a slightly ugly email beats a failed
 * send.
 */
function formatTimestamp(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toUTCString();
}

/**
 * Shared shell so all transactional emails look consistent. Body fragments
 * passed in MUST already be escaped.
 */
function htmlShell(title: string, bodyHtml: string, footerLine: string): string {
  return [
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:#f4f4f7;">',
    '<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#1a1a2e;">',
    '<div style="background:#ffffff;border-radius:8px;padding:32px;">',
    `<h1 style="margin:0 0 16px;font-size:20px;">${title}</h1>`,
    bodyHtml,
    "</div>",
    `<p style="margin:16px 0 0;font-size:12px;color:#6b6b80;text-align:center;">${footerLine}</p>`,
    "</div></body></html>",
  ].join("");
}

type TemplateRenderer = (data: TemplateData, opts: TemplateRenderOptions) => RenderedEmail;

const renderMagicLink: TemplateRenderer = (data, opts) => {
  const code = str(data, "code");
  const expires = formatTimestamp(str(data, "expiresAt"));
  const brand = opts.brandName ?? "";
  const subject = brand ? `Your ${brand} login code` : "Your login code";
  const expiryLineText = expires ? `This code expires at ${expires}.` : "This code expires shortly.";

  const text = [
    "Use this code to finish signing in:",
    "",
    code,
    "",
    expiryLineText,
    "If you did not request this code, you can safely ignore this email.",
  ].join("\n");

  const html = htmlShell(
    "Finish signing in",
    [
      '<p style="margin:0 0 16px;font-size:14px;">Use this code to finish signing in:</p>',
      `<p style="margin:0 0 16px;font-size:28px;font-weight:700;letter-spacing:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(code)}</p>`,
      `<p style="margin:0 0 8px;font-size:13px;color:#6b6b80;">${escapeHtml(expiryLineText)}</p>`,
      '<p style="margin:0;font-size:13px;color:#6b6b80;">If you did not request this code, you can safely ignore this email.</p>',
    ].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "This is an automated security email."),
  );

  return { subject, html, text };
};

const renderInvitationCreated: TemplateRenderer = (data, opts) => {
  const role = str(data, "role");
  const expires = formatTimestamp(str(data, "expiresAt"));
  const brand = opts.brandName ?? "";
  const subject = brand
    ? `You have been invited to an organization on ${brand}`
    : "You have been invited to an organization";
  const roleLineText = role
    ? `You have been invited to join an organization as ${role}.`
    : "You have been invited to join an organization.";
  const expiryLineText = expires ? `The invitation expires at ${expires}.` : "";

  const text = [
    roleLineText,
    expiryLineText,
    "Sign in with this email address to view and accept the invitation.",
    "If you were not expecting this invitation, you can safely ignore this email.",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");

  const html = htmlShell(
    "You have been invited",
    [
      `<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(roleLineText)}</p>`,
      expiryLineText
        ? `<p style="margin:0 0 16px;font-size:13px;color:#6b6b80;">${escapeHtml(expiryLineText)}</p>`
        : "",
      '<p style="margin:0 0 8px;font-size:14px;">Sign in with this email address to view and accept the invitation.</p>',
      '<p style="margin:0;font-size:13px;color:#6b6b80;">If you were not expecting this invitation, you can safely ignore this email.</p>',
    ].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "This is an automated email."),
  );

  return { subject, html, text };
};

const renderInvitationAccepted: TemplateRenderer = (data, opts) => {
  const role = str(data, "role");
  const brand = opts.brandName ?? "";
  const subject = brand ? `You have joined an organization on ${brand}` : "You have joined an organization";
  const bodyLineText = role
    ? `Your invitation was accepted and you are now a member with the ${role} role.`
    : "Your invitation was accepted and you are now a member of the organization.";

  const text = [
    bodyLineText,
    "If this was not you, contact your organization administrator.",
  ].join("\n\n");

  const html = htmlShell(
    "Welcome aboard",
    [
      `<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(bodyLineText)}</p>`,
      '<p style="margin:0;font-size:13px;color:#6b6b80;">If this was not you, contact your organization administrator.</p>',
    ].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "This is an automated email."),
  );

  return { subject, html, text };
};

// ---------------------------------------------------------------------------
// Chaseid — the director identity-verification chase (CH2)
// ---------------------------------------------------------------------------

/**
 * Where a director is sent. The ONLY link in a chase email: no token, no
 * link back into Chaseid, nothing a recipient could be phished with — the
 * recipient is told to go to GOV.UK themselves (risks CH-D). Kept in step
 * with `GOV_UK_VERIFY_URL` in `@saas/contracts/chase`.
 */
export const CHASE_GOV_UK_URL = "https://www.gov.uk/guidance/verifying-your-identity-for-companies-house";

/** The official instructions, the same in every step. Plain sentences so the
 *  text part and the html part say exactly the same thing. */
const CHASE_INSTRUCTIONS: readonly string[] = [
  "Every director and person with significant control of a UK company must now verify their identity with Companies House.",
  "To verify, go to GOV.UK and search for \"verify your identity for Companies House\", or type the address below into your browser. You can verify online with GOV.UK One Login, or in person through an authorised corporate service provider.",
  "Once you have verified you will receive a Companies House personal code. Send that code to your accountant so it can be recorded against your appointment.",
];

type ChaseStepCopy = { subject: (company: string) => string; heading: string; lead: (company: string, due: string) => string };

const CHASE_STEPS: Record<"first_notice" | "reminder" | "escalation", ChaseStepCopy> = {
  first_notice: {
    subject: (company) => `Action needed: verify your identity for ${company}`,
    heading: "Please verify your identity with Companies House",
    lead: (company, due) =>
      `Companies House records you as a director or person with significant control of ${company}, and does not yet show your identity as verified. The company's next confirmation statement is due ${due}; it cannot be filed until everyone listed has verified.`,
  },
  reminder: {
    subject: (company) => `Reminder: identity verification for ${company}`,
    heading: "A reminder: your identity is not yet verified",
    lead: (company, due) =>
      `We wrote to you a week ago about verifying your identity for ${company}. Companies House still does not show you as verified, and the confirmation statement is due ${due}.`,
  },
  escalation: {
    subject: (company) => `Urgent: ${company}'s filing is blocked until you verify`,
    heading: "Urgent: the company's filing is blocked",
    lead: (company, due) =>
      `This is our final automated reminder. ${company}'s confirmation statement is due ${due} and cannot be filed while your identity is unverified. Please verify today, or contact your accountant directly.`,
  },
};

function dueLine(data: TemplateData): string {
  const date = str(data, "nextStatementDue");
  const days = data.daysUntilDue;
  if (!date) return "soon";
  if (typeof days === "number") {
    if (days < 0) return `on ${date} (${-days} days ago)`;
    if (days === 0) return `on ${date} (today)`;
    return `on ${date} (in ${days} days)`;
  }
  return `on ${date}`;
}

function chaseRenderer(step: keyof typeof CHASE_STEPS): TemplateRenderer {
  return (data, opts) => {
    const copy = CHASE_STEPS[step];
    const person = str(data, "personName");
    const number = str(data, "companyNumber");
    const company = str(data, "companyName") || (number ? `company ${number}` : "your company");
    const brand = opts.brandName ?? "";
    const greeting = person ? `Dear ${person},` : "Hello,";
    const lead = copy.lead(company, dueLine(data));

    const subject = copy.subject(company);
    const text = [
      greeting,
      lead,
      ...CHASE_INSTRUCTIONS,
      CHASE_GOV_UK_URL,
      "This email contains no link to sign in anywhere and will never ask you for a password or a code.",
    ].join("\n\n");

    const html = htmlShell(
      escapeHtml(copy.heading),
      [
        `<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(greeting)}</p>`,
        `<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(lead)}</p>`,
        ...CHASE_INSTRUCTIONS.map((line) => `<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(line)}</p>`),
        `<p style="margin:0 0 16px;font-size:14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(CHASE_GOV_UK_URL)}</p>`,
        '<p style="margin:0;font-size:13px;color:#6b6b80;">This email contains no link to sign in anywhere and will never ask you for a password or a code.</p>',
      ].join(""),
      escapeHtml(brand ? `Sent by ${brand} on behalf of your accountant` : "Sent on behalf of your accountant."),
    );

    return { subject, html, text };
  };
}

const TEMPLATES: Record<string, TemplateRenderer> = {
  "auth.magic_link": renderMagicLink,
  "invitation.created": renderInvitationCreated,
  "invitation.accepted": renderInvitationAccepted,
  "chase.first_notice": chaseRenderer("first_notice"),
  "chase.reminder": chaseRenderer("reminder"),
  "chase.escalation": chaseRenderer("escalation"),
};

/**
 * Render the email for a template key, or null when the key has no
 * registered template. Callers (the provider adapters) MUST treat null as a
 * bounded send failure — never deliver an empty or generic body.
 */
export function renderEmailTemplate(
  templateKey: string,
  templateData: TemplateData,
  opts: TemplateRenderOptions = {},
): RenderedEmail | null {
  const renderer = TEMPLATES[templateKey];
  if (!renderer) return null;
  return renderer(templateData, opts);
}
