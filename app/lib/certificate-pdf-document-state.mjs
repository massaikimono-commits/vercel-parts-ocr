// Only certificate-derived vehicle fields are replaced on a new PDF selection.
// Same-document authoritative and recovery patches continue to merge normally.
export function beginCertificatePdfDocumentVehicle(previous, emptyVehicle) {
  return {
    ...emptyVehicle,
    customerId: previous.customerId,
    certificate: { ...emptyVehicle.certificate },
  };
}
