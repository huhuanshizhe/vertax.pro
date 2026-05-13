export interface TenantEmailDefaultInput {
  slug?: string | null;
}

export interface TenantEmailDefaults {
  replyToEmail?: string;
  fromEmail?: string;
  signature?: string;
}

const REPLY_TO_BY_TENANT: Record<string, string> = {
  tdpaint: 'engineering@tdpaint.com',
  tdpaintcell: 'engineering@tdpaint.com',
  machrio: 'sales@machrio.com',
};

const FROM_EMAIL_BY_TENANT: Record<string, string> = {
  machrio: 'VertaX <noreply@mail.machrio.com>',
  tdpaint: 'TD Painting <noreply@marketing.tdpaint.com>',
  tdpaintcell: 'TD Painting <noreply@marketing.tdpaint.com>',
};

const SIGNATURE_BY_TENANT: Record<string, string> = {
  tdpaint: 'Best regards,\nTD Painting Engineering Team\nengineering@tdpaint.com',
  tdpaintcell: 'Best regards,\nTD Painting Engineering Team\nengineering@tdpaint.com',
  machrio: 'Best regards,\nMachrio Sales Team\nsales@machrio.com',
};

export function getTenantEmailDefaults(tenant?: TenantEmailDefaultInput | null): TenantEmailDefaults {
  const slug = tenant?.slug?.trim().toLowerCase();
  if (!slug) {
    return {};
  }

  const replyToEmail = REPLY_TO_BY_TENANT[slug];
  const fromEmail = FROM_EMAIL_BY_TENANT[slug];
  const signature = SIGNATURE_BY_TENANT[slug];

  if (!replyToEmail && !fromEmail && !signature) {
    return {};
  }

  const defaults: TenantEmailDefaults = {};
  if (replyToEmail) {
    defaults.replyToEmail = replyToEmail;
  }
  if (fromEmail) {
    defaults.fromEmail = fromEmail;
  }
  if (signature) {
    defaults.signature = signature;
  }

  return defaults;
}
