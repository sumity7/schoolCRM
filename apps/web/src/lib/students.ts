export interface StudentRow {
  id: string; admissionNo: string; firstName: string; lastName?: string; status: string; gender?: string; dob: string;
  enrollment: { id?: string; sectionId: string; classId: string; rollNo?: number; status: string } | null;
}

export interface StudentDetail extends StudentRow {
  contact?: { phone?: string; email?: string };
  address?: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string };
  emergencyContacts: Array<{ name: string; relation: string; phone: string }>;
  admissionDate: string;
  statusReason?: string;
  statusChangedOn?: string;
  version: number;
}

export interface GuardianLink {
  linkId: string; guardianId: string; name?: string; phone?: string; email?: string; relationship: string; isPrimary: boolean;
  canViewFees: boolean; canPickup: boolean; portalAccess: boolean; verified: boolean; ended: boolean; version: number;
}

export const statusTone = (s: string) => (s === 'active' ? 'success' : s === 'withdrawn' || s === 'transferred' ? 'warning' : 'muted') as 'success' | 'warning' | 'muted';
export const GENDERS: Array<{ value: string; label: string }> = [
  { value: 'f', label: 'Female' }, { value: 'm', label: 'Male' }, { value: 'o', label: 'Other' }, { value: 'undisclosed', label: 'Prefer not to say' },
];
export const genderLabel = (g?: string) => GENDERS.find((x) => x.value === g)?.label ?? '—';
