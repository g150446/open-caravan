export const organizationKinds = ['facilities', 'pharmacies', 'nursingStations', 'careSupportOffices'] as const;
export type OrganizationKind = typeof organizationKinds[number];

export const organizationLabels: Record<OrganizationKind, string> = {
  facilities: '施設',
  pharmacies: '薬局',
  nursingStations: '訪問看護ステーション',
  careSupportOffices: '居宅介護支援事業所',
};

export const patientOrganizationLinks = [
  {kind: 'nursingStations', field: 'nursingStationId'},
  {kind: 'careSupportOffices', field: 'careSupportOfficeId'},
] as const;
