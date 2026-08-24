"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

export default function CertificateConsistencyFix() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let postOcrPushes = 0;
    let wasBusy = false;
    let lastKey = "";

    const resetForNewFile = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      postOcrPushes = 0;
      wasBusy = true;
      lastKey = "";
    };

    const pushAuthoritative = () => {
      const q = (window as any).__vehicleCertificateQrPriority;
      if (!q || typeof q !== "object") return;

      const patch = {
        registrationNumber: q.registrationNumber || "",
        chassisNumber: q.chassisNumber || "",
        engineModel: q.engineModel || "",
        registrationDate: q.registrationDate || "",
        firstRegistration: q.firstRegistration || "",
        inspectionExpiry: q.inspectionExpiry || "",
        model: q.model || "",
        userName: q.userName || "",
        userAddress: q.userAddress || "",
        vehicleName: q.vehicleName || "",
        vehicleClass: q.vehicleClass || "",
        purpose: q.purpose || "",
        privateBusiness: q.privateBusiness || "",
        bodyShape: q.bodyShape || "",
        seatingCapacity: q.seatingCapacity || "",
        maxPayloadKg: q.maxPayloadKg || "",
        vehicleWeightKg: q.vehicleWeightKg || "",
        grossVehicleWeightKg: q.grossVehicleWeightKg || "",
        frontFrontAxleWeightKg: q.frontFrontAxleWeightKg || "",
        frontRearAxleWeightKg: q.frontRearAxleWeightKg || "",
        rearFrontAxleWeightKg: q.rearFrontAxleWeightKg || "",
        rearRearAxleWeightKg: q.rearRearAxleWeightKg || "",
        fuel: q.fuel || "",
        modelDesignationNumber: q.modelDesignationNumber || "",
        classificationNumber: q.classificationNumber || "",
      };

      if (!Object.values(patch).some(Boolean)) return;

      const key = JSON.stringify(patch);
      const busy = Boolean(document.querySelector(".progress"));
      const changed = key !== lastKey;

      if (busy) {
        wasBusy = true;
        postOcrPushes = 0;
      } else if (wasBusy) {
        postOcrPushes += 1;
        if (postOcrPushes >= 12) wasBusy = false;
      }

      if (!changed && !busy && !wasBusy) return;

      lastKey = key;
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
    };

    document.addEventListener("change", resetForNewFile, true);
    const timer = window.setInterval(pushAuthoritative, 350);
    pushAuthoritative();

    return () => {
      document.removeEventListener("change", resetForNewFile, true);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
