"use client";

import { useLayoutEffect } from "react";
import { resolveCertificatePdfMissingFields } from "./certificate-pdf-canonical-missing-field-resolver";
import { resolveCertificatePdfGenericStructuralFields } from "./certificate-pdf-generic-structural-resolver";
import { resolveCertificatePdfSemanticFields } from "./certificate-pdf-semantic-resolver";
import { resolveCertificatePdfWeightDisplacementFields } from "./certificate-pdf-weight-displacement-resolver";
import { isCertificateInspectionRecord, parseCertificateInspectionRecordLines } from "./certificate-pdf-inspection-record-adapter";
import { commitCertificatePdfFinal, createCertificatePdfCompletionContract, createCertificatePdfRunOwnership } from "./certificate-pdf-single-owner-contract";
import { beginCertificatePdfDiagnosticRun, checkpointCertificatePdfDiagnostic, formatCertificatePdfDiagnosticSnapshot, getCertificatePdfDiagnosticSnapshot, isCertificatePdfDiagnosticUiEnabled, subscribeCertificatePdfDiagnostics, terminalCertificatePdfDiagnostic } from "./certificate-pdf-runtime-diagnostics";
import { getCertificatePdfPassConsumer, getCertificatePdfProgrammaticChangeOrigin, observeCertificatePdfPassConsumer, observeCertificatePdfProgrammaticChange } from "./certificate-pdf-programmatic-change-origin";
import { claimCertificatePdfV3Event, isCertificatePdfV3FallbackEvent, markCertificatePdfV3FallbackEvent } from "./certificate-pdf-fallback-event-ownership";
import { beginCertificatePdfFieldProvenance, getCertificatePdfFieldProvenance, isCertificatePdfFieldProvenanceEnabled, observeCertificatePdfFieldApply, observeCertificatePdfFieldRaw, observeCertificatePdfFieldRows, observeCertificatePdfFieldStage, terminalCertificatePdfFieldProvenance } from "./certificate-pdf-field-provenance";
import { removeCertificatePdfFieldProvenanceUi, showCertificatePdfFieldProvenanceUi } from "./certificate-pdf-field-provenance-ui";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";
const QR_PRIORITY_KEY = "__vehicleCertificateQrPriority";
const PASS_KEY = "pdfStructuredV3PassThrough";

let nextCertificatePdfComponentInstanceId = 0;
let nextCertificatePdfListenerInstanceId = 0;
let nextCertificatePdfMountGeneration = 0;
let latestCertificatePdfProvenanceRun = null;
let nextCertificatePdfEventSequence = 0;
let certificatePdfUserSelectionCount = 0;
const certificatePdfEventProvenance = new WeakMap();

function safeCertificatePdfEventProvenance(event) {
  try {
    const existing = certificatePdfEventProvenance.get(event);
    if (existing) return existing;
    const value = {
      eventSequence: ++nextCertificatePdfEventSequence,
      userSelectionCount: event?.isTrusted ? ++certificatePdfUserSelectionCount : certificatePdfUserSelectionCount,
    };
    certificatePdfEventProvenance.set(event, value);
    return value;
  } catch {
    return { eventSequence: 0, userSelectionCount: certificatePdfUserSelectionCount };
  }
}

function safeCertificatePdfFileFingerprint(file) {
  try {
    if (!file) return "none";
    return [
      `n${String(file.name || "").length}`,
      `s${Number(file.size) || 0}`,
      `t${String(file.type || "")}`,
      `m${Number(file.lastModified) || 0}`,
    ].join(":");
  } catch {
    return "unavailable";
  }
}

function safeCertificatePdfCheckpoint(diagnosticId, checkpoint, metadata = {}) {
  try {
    return checkpointCertificatePdfDiagnostic(diagnosticId, checkpoint, metadata);
  } catch {
    return null;
  }
}

function safeCertificatePdfPassKeyState(input) {
  try {
    return input?.dataset?.[PASS_KEY] === "1";
  } catch {
    return null;
  }
}

function safeBeginCertificatePdfDiagnosticRun(runId, metadata) {
  try {
    return beginCertificatePdfDiagnosticRun(runId, metadata)?.diagnosticId || null;
  } catch {
    return null;
  }
}

function safeCertificatePdfPreviousRun() {
  const empty = {
    previousActiveRunId: null,
    previousCheckpoint: null,
    previousTerminalState: null,
    previousComponentInstanceId: null,
    previousListenerInstanceId: null,
    previousMountGeneration: null,
    snapshot: null,
  };
  try {
    if (!latestCertificatePdfProvenanceRun) return empty;
    const previous = latestCertificatePdfProvenanceRun;
    const snapshot = getCertificatePdfDiagnosticSnapshot(previous.diagnosticId);
    return {
      previousActiveRunId: snapshot?.terminalState === "processing" ? previous.runId : null,
      previousCheckpoint: snapshot?.checkpoint || null,
      previousTerminalState: snapshot?.terminalState || null,
      previousComponentInstanceId: previous.componentInstanceId,
      previousListenerInstanceId: previous.listenerInstanceId,
      previousMountGeneration: previous.mountGeneration,
      snapshot,
    };
  } catch {
    return empty;
  }
}

function isCertificatePdfRenderPending(previous) {
  try {
    if (previous?.previousTerminalState !== "processing") return false;
    const checkpoints = previous.snapshot?.checkpoints || [];
    let renderStartedAt = -1;
    for (let index = 0; index < checkpoints.length; index += 1) {
      if (checkpoints[index]?.checkpoint === "RENDER_PROMISE_STARTED") renderStartedAt = index;
    }
    if (renderStartedAt < 0) return false;
    const settled = new Set([
      "RENDER_PROMISE_FULFILLED",
      "RENDER_PROMISE_REJECTED",
      "COMPLETED",
      "FALLBACK",
      "ERROR",
      "CANCELLED",
    ]);
    return !checkpoints.slice(renderStartedAt + 1).some((item) => settled.has(item?.checkpoint));
  } catch {
    return false;
  }
}

function safeCertificatePdfRunEntryMetadata(event, input, file, identity, previous, runId = null) {
  try {
    const eventProvenance = safeCertificatePdfEventProvenance(event);
    const programmaticOrigin = getCertificatePdfProgrammaticChangeOrigin(event);
    const passConsumer = getCertificatePdfPassConsumer(event);
    return {
      runId,
      eventIsTrusted: Boolean(event?.isTrusted),
      eventType: String(event?.type || ""),
      eventPhase: Number(event?.eventPhase) || 0,
      eventSequence: eventProvenance.eventSequence,
      userSelectionCount: eventProvenance.userSelectionCount,
      programmaticChangeOrigin: programmaticOrigin.programmaticChangeOrigin,
      originSequence: programmaticOrigin.originSequence,
      passConsumerCount: passConsumer?.passConsumerCount ?? 0,
      passConsumerComponentInstanceId: passConsumer?.passConsumerComponentInstanceId ?? null,
      passConsumerListenerInstanceId: passConsumer?.passConsumerListenerInstanceId ?? null,
      passConsumerMountGeneration: passConsumer?.passConsumerMountGeneration ?? null,
      componentInstanceId: identity.componentInstanceId,
      listenerInstanceId: identity.listenerInstanceId,
      mountGeneration: identity.mountGeneration,
      fileFingerprint: safeCertificatePdfFileFingerprint(file),
      passKeyState: input?.dataset?.[PASS_KEY] === "1",
      pdfNativeV2PassThroughState: input?.dataset?.pdfNativeV2PassThrough === "1",
      pdfNativePassThroughState: input?.dataset?.pdfNativePassThrough === "1",
      previousActiveRunId: previous?.previousActiveRunId ?? null,
      previousCheckpoint: previous?.previousCheckpoint ?? null,
      previousTerminalState: previous?.previousTerminalState ?? null,
      previousComponentInstanceId: previous?.previousComponentInstanceId ?? null,
      previousListenerInstanceId: previous?.previousListenerInstanceId ?? null,
      previousMountGeneration: previous?.previousMountGeneration ?? null,
    };
  } catch {
    return {
      runId,
      eventIsTrusted: false,
      eventType: "",
      eventPhase: 0,
      eventSequence: 0,
      userSelectionCount: certificatePdfUserSelectionCount,
      programmaticChangeOrigin: null,
      originSequence: null,
      passConsumerCount: 0,
      passConsumerComponentInstanceId: null,
      passConsumerListenerInstanceId: null,
      passConsumerMountGeneration: null,
      componentInstanceId: identity?.componentInstanceId || "unavailable",
      listenerInstanceId: identity?.listenerInstanceId || "unavailable",
      mountGeneration: identity?.mountGeneration || 0,
      fileFingerprint: "unavailable",
      passKeyState: false,
      pdfNativeV2PassThroughState: false,
      pdfNativePassThroughState: false,
      previousActiveRunId: null,
      previousCheckpoint: null,
      previousTerminalState: null,
      previousComponentInstanceId: null,
      previousListenerInstanceId: null,
      previousMountGeneration: null,
    };
  }
}

const MAKERS = ["トヨタ", "レクサス", "日産", "ニッサン", "ホンダ", "三菱", "マツダ", "スバル", "スズキ", "ダイハツ", "いすゞ", "日野", "UDトラックス", "メルセデス・ベンツ", "フォルクスワーゲン", "アウディ", "BMW", "ボルボ"];
const BODY_TYPES = ["キャブオーバ", "ステーションワゴン", "ボンネット", "ピックアップ", "トラック", "ダンプ", "セダン", "箱型", "バン", "バス", "幌型"];

function makerFromText(text) {
  const raw = norm(text);
  const dense = compact(raw);
  return MAKERS.find((value) => raw.includes(value) || dense.includes(compact(value))) || "";
}

function bodyTypeFromText(text) {
  const dense = compact(text);
  return BODY_TYPES.find((value) => dense.includes(compact(value))) || "";
}

function norm(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function compact(value) {
  return norm(value).replace(/[\s:：・,，.。()（）\[\]［］]/g, "");
}

function jpMonth(text) {
  const m = norm(text).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);
  if (!m) return "";
  const month = Number(m[3]);
  if (month < 1 || month > 12) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月`;
}

function jpDate(text) {
  const m = norm(text).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return "";
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月${day}日`;
}

function registration(text) {
  const m = norm(text).match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);
  return m ? `${m[1]} ${m[2].replace(/\D/g, "")} ${m[3]} ${m[4].replace(/\D/g, "")}` : "";
}

function tokenFromItem(item, pageWidth, pageHeight) {
  const text = norm(item?.str || "");
  if (!text) return null;
  const tr = item?.transform || [1, 0, 0, 1, 0, 0];
  const x = Number(tr[4] || 0) / Math.max(1, pageWidth);
  const baseline = Number(tr[5] || 0) / Math.max(1, pageHeight);
  const h = Math.max(Math.abs(Number(tr[3] || 0)), Number(item?.height || 0), 1) / Math.max(1, pageHeight);
  const w = Math.max(Number(item?.width || 0), 1) / Math.max(1, pageWidth);
  return { text, x, y: 1 - baseline, w, h };
}

function buildLines(tokens) {
  const lines = [];
  for (const token of [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let line = lines.find((candidate) => Math.abs(candidate.y - token.y) <= Math.max(0.0045, token.h * 0.72));
    if (!line) {
      line = { y: token.y, tokens: [] };
      lines.push(line);
    }
    line.tokens.push(token);
    line.y = line.tokens.reduce((sum, value) => sum + value.y, 0) / line.tokens.length;
  }
  for (const line of lines) {
    line.tokens.sort((a, b) => a.x - b.x);
    line.text = line.tokens.map((token) => token.text).join(" ");
  }
  return lines.sort((a, b) => a.y - b.y);
}

function findLineIndex(lines, matcher) {
  return lines.findIndex((line) => matcher(compact(line.text)));
}

function nextNonEmptyLine(lines, index, maxAhead = 4) {
  if (index < 0) return null;
  for (let i = index + 1; i < Math.min(lines.length, index + 1 + maxAhead); i += 1) {
    if (norm(lines[i]?.text)) return { line: lines[i], index: i };
  }
  return null;
}

function valueAfterLabel(line, label) {
  if (!line?.tokens?.length) return "";
  const wanted = compact(label);
  let joined = "";
  for (let i = 0; i < line.tokens.length; i += 1) {
    joined += compact(line.tokens[i].text);
    if (joined.includes(wanted)) {
      return norm(line.tokens.slice(i + 1).map((token) => token.text).join(" "));
    }
    if (joined.length > wanted.length + 40) break;
  }
  const whole = norm(line.text);
  const dense = compact(whole);
  const at = dense.indexOf(wanted);
  if (at < 0) return "";
  return "";
}

function parseStructured(lines, observeStage = null) {
  const patch = {};
  const observe = (...args) => { try { observeStage?.(...args); } catch {} };
  const allText = lines.map((line) => line.text).join("\n");
  const put = (key, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      patch[key] = String(value).trim();
    }
  };
  const rowText = (index) => norm(lines[index]?.text || "");
  const joinedAfter = (index, count = 3) =>
    lines
      .slice(Math.max(0, index + 1), Math.min(lines.length, index + 1 + count))
      .map((line) => norm(line.text))
      .filter(Boolean)
      .join(" ");

  // 作成日付（記録年月日）
  const firstLine = lines.find((line) => compact(line.text).includes("作成日付"));
  if (firstLine) {
    const m = norm(firstLine.text).match(
      /作成日付\s*[:：]?\s*((?:令和|平成|昭和)\s*(?:元|\d{1,2})\s*年?\s*\d{1,2}\s*月?\s*\d{1,2}\s*日?)/
    );
    if (m) put("recordDate", jpDate(m[1]));
  }

  // 普通車/軽自動車の双方に対応。
  // 軽自動車の記録事項PDFでは「車両番号」「交付年月日」「初度検査年月」と表記される。
  const topHeader = findLineIndex(
    lines,
    (t) =>
      (t.includes("自動車登録番号又は車両番号") || t.includes("車両番号")) &&
      (t.includes("初度登録年月") || t.includes("初度検査年月")) &&
      t.includes("車体の形状")
  );
  const topValue = nextNonEmptyLine(lines, topHeader, 3)?.line;
  if (topValue) {
    const text = norm(topValue.text);
    put("registrationNumber", registration(text));
    const dates = [
      ...text.matchAll(
        /(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?(?:\s*(\d{1,2})\s*日?)?/g
      ),
    ];
    if (dates[0]) put("registrationDate", jpDate(dates[0][0]));
    if (dates[1]) put("firstRegistration", jpMonth(dates[1][0]));
    put("vehicleClass", ["普通", "小型", "軽自動車", "大型特殊"].find((v) => text.includes(v)) || "");
    put("purpose", ["乗用", "貨物", "乗合", "特種"].find((v) => text.includes(v)) || "");
    put("privateBusiness", ["自家用", "事業用"].find((v) => text.includes(v)) || "");
    put("bodyShape", bodyTypeFromText(text));
  }

  // 普通車の車名/重量行。
  const weightHeader = findLineIndex(
    lines,
    (t) =>
      t.includes("車名") &&
      t.includes("乗車定員") &&
      t.includes("最大積載量") &&
      t.includes("車両重量") &&
      t.includes("車両総重量")
  );
  const weightValue = nextNonEmptyLine(lines, weightHeader, 3)?.line;
  if (weightValue) {
    const text = norm(weightValue.text);
    put("vehicleName", makerFromText(text));
    const seat = text.match(/(?:\[[^\]]+\]\s*)?(\d{1,2})\s*人/);
    if (seat) put("seatingCapacity", String(Number(seat[1])));
    const kg = [...text.matchAll(/(-|\d{1,5})\s*kg/gi)].map((m) => m[1]);
    if (kg.length >= 3) {
      put("maxPayloadKg", kg[0] === "-" ? "-" : String(Number(kg[0])));
      put("vehicleWeightKg", kg[1] === "-" ? "-" : String(Number(kg[1])));
      put("grossVehicleWeightKg", kg[2] === "-" ? "-" : String(Number(kg[2])));
    }
  }

  // 軽自動車の記録事項PDFは、車台番号・定員・重量・寸法を同じ見出しにし、
  // 値を2行に分けることがある。ブラケット内の管理値は無視し、単位付き値を採用する。
  const keiChassisHeader = findLineIndex(
    lines,
    (t) =>
      t.includes("車台番号") &&
      t.includes("乗車定員") &&
      t.includes("最大積載量") &&
      t.includes("車両重量") &&
      t.includes("長さ") &&
      t.includes("幅") &&
      t.includes("高さ")
  );
  if (keiChassisHeader >= 0) {
    const text = joinedAfter(keiChassisHeader, 3).toUpperCase();
    const chassis = text.match(/\b([A-Z]{1,6}[A-Z0-9]{0,8}-[A-Z0-9]{4,14})\b/i);
    if (chassis) put("chassisNumber", chassis[1].replace(/O/g, "0"));

    const seat = text.match(/(\d{1,2})\s*人/);
    if (seat) put("seatingCapacity", String(Number(seat[1])));

    const kg = [...text.matchAll(/(-|\d{1,5})\s*kg/gi)].map((m) => m[1]);
    if (kg.length >= 3) {
      put("maxPayloadKg", kg[0] === "-" ? "-" : String(Number(kg[0])));
      put("vehicleWeightKg", kg[1] === "-" ? "-" : String(Number(kg[1])));
      put("grossVehicleWeightKg", kg[2] === "-" ? "-" : String(Number(kg[2])));
    }

    const cm = [...text.matchAll(/(\d{2,4})\s*cm/gi)].map((m) => m[1]);
    if (cm.length >= 3) {
      put("lengthCm", String(Number(cm[0])));
      put("widthCm", String(Number(cm[1])));
      put("heightCm", String(Number(cm[2])));
    }
  }

  // 普通車の車台番号・寸法・4軸重。
  const dimensionHeader = findLineIndex(
    lines,
    (t) =>
      t.includes("車台番号") &&
      t.includes("長さ") &&
      t.includes("幅") &&
      t.includes("高さ") &&
      t.includes("前前軸重") &&
      t.includes("後後軸重")
  );
  const dimensionValue = nextNonEmptyLine(lines, dimensionHeader, 3)?.line;
  if (dimensionValue) {
    const text = norm(dimensionValue.text).toUpperCase();
    const m = text.match(
      /([A-Z]{1,6}[A-Z0-9]{0,8}-[A-Z0-9]{4,14})\s+(\d{2,4})\s*cm\s+(\d{2,4})\s*cm\s+(\d{2,4})\s*cm\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg/i
    );
    if (m) {
      put("chassisNumber", m[1].replace(/O/g, "0"));
      put("lengthCm", String(Number(m[2])));
      put("widthCm", String(Number(m[3])));
      put("heightCm", String(Number(m[4])));
      put("frontFrontAxleWeightKg", m[5] === "-" ? "-" : String(Number(m[5])));
      put("frontRearAxleWeightKg", m[6] === "-" ? "-" : String(Number(m[6])));
      put("rearFrontAxleWeightKg", m[7] === "-" ? "-" : String(Number(m[7])));
      put("rearRearAxleWeightKg", m[8] === "-" ? "-" : String(Number(m[8])));
    }
  }

  // 型式・原動機・排気量・燃料・指定番号・類別番号。
  // 値の並びは普通車と軽自動車で異なるため、1本の厳しい正規表現に依存しない。
  const modelHeader = findLineIndex(
    lines,
    (t) =>
      t.includes("型式") &&
      t.includes("原動機の型式") &&
      t.includes("総排気量又は定格出力") &&
      t.includes("燃料の種類") &&
      t.includes("型式指定番号") &&
      t.includes("類別区分番号")
  );
  if (modelHeader >= 0) {
    let next = nextNonEmptyLine(lines, modelHeader, 4);
    if (next && /^KW$/i.test(norm(next.line.text))) next = nextNonEmptyLine(lines, next.index, 2);
    if (next) {
      const raw = norm(next.line.text);
      const text = raw.toUpperCase();

      put("vehicleName", makerFromText(raw) || patch.vehicleName || "");

      const modelMatch = text.match(/\b((?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{2,14})\b/i);
      if (modelMatch) {
        put("model", modelMatch[1]);
        const rest = text.slice((modelMatch.index || 0) + modelMatch[0].length).trim();
        const engine = rest.match(/^([A-Z0-9]{2,10}(?:-[A-Z0-9]{2,10})?)(?:\s|$)/i);
        if (engine && !["L", "KW"].includes(engine[1].toUpperCase())) put("engineModel", engine[1]);
      }

      const fuel = ["軽油", "ガソリン", "揮発油", "電気", "LPG", "CNG", "水素"].find((v) =>
        raw.includes(v)
      );
      if (fuel) put("fuel", fuel);

      let displacement = null;
      if (fuel) {
        displacement =
          raw.match(new RegExp("(\\d+(?:\\.\\d+)?)\\s*(L|kW|KW)\\s+" + fuel, "i")) ||
          raw.match(new RegExp(fuel + "\\s+(\\d+(?:\\.\\d+)?)\\s*(L|kW|KW)", "i"));
      }
      if (!displacement) displacement = raw.match(/(\d+(?:\.\d+)?)\s*(L|kW|KW)\b/i);
      if (displacement) {
        put(
          "displacementOrRatedOutput",
          String(displacement[1]) + " " + String(displacement[2]).toUpperCase()
        );
      }

      const tail = text.match(/(?:^|\s)(\d{4,6})\s+(\d{4})\s*$/);
      if (tail) {
        put("modelDesignationNumber", tail[1]);
        put("classificationNumber", tail[2]);
      }

      // 軽自動車では「前軸重」「後軸重」の2値。4軸形式の互換フィールドに安全に割り当てる。
      const headerDense = compact(rowText(modelHeader));
      const axleKg = [...raw.matchAll(/(\d{1,5})\s*kg/gi)].map((m) => m[1]);
      if (headerDense.includes("前軸重") && headerDense.includes("後軸重") && axleKg.length >= 2) {
        put("frontFrontAxleWeightKg", String(Number(axleKg[0])));
        put("rearRearAxleWeightKg", String(Number(axleKg[1])));
      }
    }
  }

  // 使用者情報。通常レイアウトを優先。
  const userNameLine = lines.find((line) => compact(line.text).includes("使用者の氏名又は名称"));
  if (userNameLine) {
    put(
      "userName",
      valueAfterLabel(userNameLine, "使用者の氏名又は名称")
        .replace(/\s*\[[0-9\s]+\]\s*$/, "")
        .trim()
    );
  }
  const userAddressLine = lines.find(
    (line) => compact(line.text).includes("使用者の住所") && !compact(line.text).includes("所有者の住所")
  );
  if (userAddressLine) {
    put(
      "userAddress",
      valueAfterLabel(userAddressLine, "使用者の住所")
        .replace(/\s*\[[0-9\s]+\]\s*$/, "")
        .trim()
    );
  }

  // 軽自動車PDFでは「使 / 用 / 者」が縦方向に分割される場合がある。
  if (!patch.userName) {
    const sectionStart = Math.max(0, modelHeader + 1);
    const baseIndex = findLineIndex(lines, (t) => t.includes("使用の本拠の位置"));
    const sectionEnd = Math.min(lines.length, baseIndex >= 0 ? baseIndex : sectionStart + 12);
    for (let i = sectionStart; i < sectionEnd; i += 1) {
      const text = norm(lines[i].text);
      const dense = compact(text);
      if (!dense.includes("氏名又は名称")) continue;
      const value = text.replace(/^.*?氏名又は名称\s*/, "").trim();
      if (value && value !== "使用者に同じ" && !value.includes("所有者")) {
        put("userName", value.replace(/\s*\[[0-9\s]+\]\s*$/, "").trim());
        for (let j = i + 1; j < Math.min(sectionEnd, i + 5); j += 1) {
          const addressText = norm(lines[j].text);
          if (!compact(addressText).includes("住所")) continue;
          const address = addressText
            .replace(/^.*?住\s*所\s*/, "")
            .replace(/\s*\[[0-9\s]+\]\s*$/, "")
            .trim();
          if (address && address !== "使用者に同じ") put("userAddress", address);
          break;
        }
        break;
      }
    }
  }

  // 使用の本拠は値が無いPDFでは空欄のまま。
  const baseLine = lines.find((line) => compact(line.text).includes("使用の本拠の位置"));
  if (baseLine) {
    const base = valueAfterLabel(baseLine, "使用の本拠の位置").trim();
    if (base && base.length <= 100) put("baseLocation", base);
  }

  // 有効期限。軽自動車PDFでは追加情報行を挟むことがあるので数行先まで探す。
  const expiryHeader = findLineIndex(lines, (t) => t.includes("有効期間の満了する日"));
  if (expiryHeader >= 0) {
    for (let i = expiryHeader; i < Math.min(lines.length, expiryHeader + 7); i += 1) {
      const value = jpDate(lines[i].text);
      if (value) {
        put("inspectionExpiry", value);
        break;
      }
    }
  }

  // 全体からの安全な補完（構造行に無かった時のみ）。
  if (!patch.registrationNumber) put("registrationNumber", registration(allText));
  if (!patch.vehicleName) put("vehicleName", makerFromText(allText));

  observe("strict", {}, patch, patch);
  const strictPatch = observeStage ? { ...patch } : null;
  const generic = resolveCertificatePdfGenericStructuralFields(lines, patch);
  Object.assign(patch, generic.patch);
  const recovered = resolveCertificatePdfMissingFields(lines, patch);
  Object.assign(patch, recovered.patch);
  observe("canonical", strictPatch, recovered.patch, patch, { ...generic.provenance, ...recovered.provenance });
  const canonicalPatch = observeStage ? { ...patch } : null;
  const semantic = resolveCertificatePdfSemanticFields(lines, patch);
  Object.assign(patch, semantic.patch);
  observe("semantic", canonicalPatch, semantic.patch, patch, semantic.provenance);
  const semanticPatch = observeStage ? { ...patch } : null;
  const weightDisplacement = resolveCertificatePdfWeightDisplacementFields(lines, patch);
  Object.assign(patch, weightDisplacement.patch);
  observe("weight", semanticPatch, weightDisplacement.patch, patch, weightDisplacement.provenance);
  observe("displacement", semanticPatch, weightDisplacement.patch, patch, weightDisplacement.provenance);
  if (isCertificateInspectionRecord(lines)) {
    const inspection = parseCertificateInspectionRecordLines(lines);
    for (const [key, value] of Object.entries(inspection.patch || {})) {
      if ((patch[key] === undefined || patch[key] === "") && value !== undefined && value !== "") patch[key] = value;
    }
    patch.__inspectionRecordType = "AUTOMOBILE_INSPECTION_RECORD";
  }

  const required = [
    "registrationNumber",
    "chassisNumber",
    "model",
    "vehicleName",
    "registrationDate",
    "firstRegistration",
    "vehicleClass",
    "purpose",
    "privateBusiness",
    "bodyShape",
    "seatingCapacity",
    "maxPayloadKg",
    "vehicleWeightKg",
    "grossVehicleWeightKg",
    "lengthCm",
    "widthCm",
    "heightCm",
    "frontFrontAxleWeightKg",
    "frontRearAxleWeightKg",
    "rearFrontAxleWeightKg",
    "rearRearAxleWeightKg",
    "engineModel",
    "displacementOrRatedOutput",
    "fuel",
    "modelDesignationNumber",
    "classificationNumber",
    "userName",
    "userAddress",
    "inspectionExpiry",
  ];
  const found = required.filter(
    (key) => Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== ""
  ).length;
  const strong = Boolean(
    patch.registrationNumber &&
      patch.chassisNumber &&
      patch.model &&
      patch.vehicleName &&
      patch.vehicleWeightKg &&
      patch.grossVehicleWeightKg &&
      patch.lengthCm &&
      patch.widthCm &&
      patch.heightCm &&
      patch.engineModel &&
      patch.fuel &&
      found >= 22
  );
  observe("final", strictPatch, weightDisplacement.patch, patch, {
    ...generic.provenance, ...recovered.provenance, ...semantic.provenance, ...weightDisplacement.provenance,
  });
  return { patch, found, strong, lines, allText };
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // The first PDF change can race the route-level localizer. Set the bundled
  // worker at the point immediately before getDocument() is called so a fresh
  // session never falls back to an external CDN worker.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  return pdfjs;
}

async function pageTokens(page, observeContent = null) {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const tokens = (content.items || []).map((item) => tokenFromItem(item, viewport.width, viewport.height)).filter(Boolean);
  try { observeContent?.(content.items || [], tokens); } catch {}
  return tokens;
}

async function choosePage(pdf, observePage = null) {
  let best = { pageNumber: 1, tokens: [], score: -1 };
  const max = Math.min(pdf.numPages || 1, 8);
  for (let n = 1; n <= max; n += 1) {
    const page = await pdf.getPage(n);
    const tokens = await pageTokens(page, observePage ? (items, result) => observePage(n, items, result) : null).catch(() => []);
    const text = compact(tokens.map((token) => token.text).join(" "));
    let score = 0;
    if (text.includes("車両情報")) score += 4;
    if (text.includes("自動車登録番号") || text.includes("車両番号")) score += 3;
    if (text.includes("車台番号")) score += 3;
    if (text.includes("車両重量")) score += 2;
    if (text.includes("原動機の型式")) score += 2;
    if (score > best.score) best = { pageNumber: n, tokens, score };
  }
  return best;
}

// Shared native-PDF entry point. The single-registration reader and bulk import
// must use the same structured parser so identical PDFs produce identical fields.
export async function parseVehicleCertificatePdfStructured(file) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const chosen = await choosePage(pdf);
    const page = await pdf.getPage(chosen.pageNumber);
    const tokens = chosen.tokens.length ? chosen.tokens : await pageTokens(page);
    const parsed = parseStructured(buildLines(tokens));
    return {
      patch: parsed.patch,
      strong: parsed.strong,
      confident: parsed.strong,
      found: parsed.found,
      totalCount: parsed.found,
      pageNumber: chosen.pageNumber,
      pageCount: pdf.numPages || 1,
      parser: "structured-v3",
    };
  } finally {
    await pdf.destroy?.();
  }
}

function isCertificatePdfCfAcPreflightEnabled(locationLike = globalThis.location) {
  if (!isCertificatePdfDiagnosticUiEnabled(locationLike)) return false;
  return new URLSearchParams(locationLike?.search || "").get("certificatePdfCfAc") === "1";
}

async function runCertificatePdfCfAcPreflight(file, pdfjs, diagnosticId) {
  checkpointCertificatePdfDiagnostic(diagnosticId, "CF_PREFLIGHT_STARTED");
  const preflightBuffer = await file.arrayBuffer();
  checkpointCertificatePdfDiagnostic(diagnosticId, "CF_PREFLIGHT_BUFFER_READY", { byteLength: preflightBuffer.byteLength });
  checkpointCertificatePdfDiagnostic(diagnosticId, "CF_PREFLIGHT_DOCUMENT_STARTED");
  const preflightPdf = await pdfjs.getDocument({ data: new Uint8Array(preflightBuffer) }).promise;
  checkpointCertificatePdfDiagnostic(diagnosticId, "CF_PREFLIGHT_DOCUMENT_READY", { pageCount: preflightPdf.numPages || 0 });
  const preflightPage = await preflightPdf.getPage(1);
  checkpointCertificatePdfDiagnostic(diagnosticId, "CF_PREFLIGHT_PAGE_READY");
  await preflightPage.getTextContent();
  checkpointCertificatePdfDiagnostic(diagnosticId, "CF_PREFLIGHT_TEXT_READY");
  checkpointCertificatePdfDiagnostic(diagnosticId, "CF_PREFLIGHT_DESTROY_STARTED");
  await preflightPdf.destroy();
  checkpointCertificatePdfDiagnostic(diagnosticId, "CF_PREFLIGHT_DESTROY_DONE");
}

async function renderPage(pdf, pageNumber, targetWidth = 1800, diagnosticId = null) {
  checkpointCertificatePdfDiagnostic(diagnosticId, "RENDER_PAGE_ENTER");
  checkpointCertificatePdfDiagnostic(diagnosticId, "PAGE_OBJECT_STARTED");
  const page = await pdf.getPage(pageNumber);
  checkpointCertificatePdfDiagnostic(diagnosticId, "PAGE_OBJECT_READY");
  const base = page.getViewport({ scale: 1 });
  checkpointCertificatePdfDiagnostic(diagnosticId, "BASE_VIEWPORT_READY");
  const scale = Math.max(1, Math.min(4, targetWidth / Math.max(1, base.width)));
  const viewport = page.getViewport({ scale });
  checkpointCertificatePdfDiagnostic(diagnosticId, "SCALED_VIEWPORT_READY");
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  checkpointCertificatePdfDiagnostic(diagnosticId, "CANVAS_READY");
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  checkpointCertificatePdfDiagnostic(diagnosticId, "CONTEXT_READY");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  checkpointCertificatePdfDiagnostic(diagnosticId, "RENDER_TASK_CREATE_STARTED");
  const renderTask = page.render({ canvasContext: ctx, viewport });
  checkpointCertificatePdfDiagnostic(diagnosticId, "RENDER_TASK_CREATED");
  checkpointCertificatePdfDiagnostic(diagnosticId, "RENDER_PROMISE_STARTED");
  try {
    await renderTask.promise;
    checkpointCertificatePdfDiagnostic(diagnosticId, "RENDER_PROMISE_FULFILLED");
  } catch (error) {
    checkpointCertificatePdfDiagnostic(diagnosticId, "RENDER_PROMISE_REJECTED", safeRenderDiagnosticError(error));
    throw error;
  }
  checkpointCertificatePdfDiagnostic(diagnosticId, "RENDER_PROMISE_DONE");
  checkpointCertificatePdfDiagnostic(diagnosticId, "RENDER_PAGE_RETURN");
  return canvas;
}

function safeRenderDiagnosticError(error) {
  try {
    return {
      errorName: String(error?.name || "Error").slice(0, 80),
      safeMessage: String(error?.message || error || "RenderTask rejected").replace(/\s+/g, " ").slice(0, 240),
    };
  } catch {
    return { errorName: "Error", safeMessage: "RenderTask rejection details unavailable" };
  }
}

function cropLower(source) {
  const y = Math.round(source.height * 0.48);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height - y;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, y, source.width, source.height - y, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function hasQr(canvas) {
  try {
    const browser = await import("@zxing/browser");
    const lib = await import("@zxing/library");
    const hints = new Map();
    hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
    hints.set(lib.DecodeHintType.TRY_HARDER, true);
    const reader = new browser.BrowserQRCodeReader(hints);
    for (const source of [canvas, cropLower(canvas)]) {
      try {
        const result = await reader.decodeFromCanvas(source);
        if (result?.getText?.() || result?.text || result?.getRawBytes?.()?.length) return true;
      } catch {}
    }
  } catch {}
  return false;
}

function vehicleCard() {
  return Array.from(document.querySelectorAll("section.card")).find((section) => section.querySelector("h2")?.textContent?.includes("車検証から読み取る")) || null;
}

function showStatus(message, error = false) {
  const card = vehicleCard();
  if (!card) return;
  let box = card.querySelector("[data-pdf-structured-v3-status]");
  if (!box) {
    box = document.createElement("div");
    box.dataset.pdfStructuredV3Status = "1";
    box.style.marginTop = "12px";
    box.style.padding = "14px";
    box.style.borderRadius = "14px";
    box.style.border = "1px solid #a8ddbf";
    box.style.fontWeight = "800";
    card.querySelector(".actions")?.insertAdjacentElement("afterend", box);
  }
  box.textContent = message;
  box.style.background = error ? "#fff1f1" : "#effaf4";
  box.style.borderColor = error ? "#efb7b7" : "#a8ddbf";
  box.style.color = error ? "#922" : "#174c2e";
}

function showDiagnostic(snapshot) {
  showCertificatePdfFieldProvenanceUi(snapshot);
  if (!isCertificatePdfDiagnosticUiEnabled()) return;
  const card = vehicleCard();
  if (!card) return;
  let box = card.querySelector("[data-pdf-structured-v3-diagnostic]");
  if (!box) {
    box = document.createElement("pre");
    box.dataset.pdfStructuredV3Diagnostic = "1";
    box.style.cssText = "margin-top:10px;padding:10px;border-radius:10px;border:1px solid #b8c7dc;background:#f7f9fc;color:#334155;font:700 12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap";
    card.querySelector(".actions")?.insertAdjacentElement("afterend", box);
  }
  const rejected = snapshot?.checkpoints?.findLast?.((item) => item.checkpoint === "RENDER_PROMISE_REJECTED");
  const handlerEntries = snapshot?.checkpoints?.filter((item) => item.checkpoint === "V3_HANDLER_ENTER") || [];
  const runStarts = snapshot?.checkpoints?.filter((item) => item.checkpoint === "RUN_STARTED") || [];
  const reentries = snapshot?.checkpoints?.filter((item) => item.checkpoint === "RUN_REENTRY_WHILE_RENDER_PENDING") || [];
  const passObserved = snapshot?.checkpoints?.findLast?.((item) => item.checkpoint === "V3_PASS_OBSERVED");
  const passConsumed = snapshot?.checkpoints?.findLast?.((item) => item.checkpoint === "V3_PASS_CONSUMED");
  const provenance = handlerEntries.at(-1)?.metadata || runStarts.at(-1)?.metadata;
  const reentry = reentries.at(-1)?.metadata;
  const details = snapshot ? [`Diagnostic: ${snapshot.diagnosticId}`] : [];
  if (rejected) details.push(`Render rejection: ${rejected.metadata.errorName}: ${rejected.metadata.safeMessage}`);
  if (passObserved) details.push(`PASS observed: origin=${passObserved.metadata.originSequence} event=${passObserved.metadata.eventSequence} listener=${passObserved.metadata.listenerInstanceId} before=${passObserved.metadata.passKeyStateBeforeConsume}`);
  if (passConsumed) details.push(`PASS consumed: origin=${passConsumed.metadata.originSequence} event=${passConsumed.metadata.eventSequence} count=${passConsumed.metadata.passConsumerCount} component=${passConsumed.metadata.passConsumerComponentInstanceId} listener=${passConsumed.metadata.passConsumerListenerInstanceId} mount=${passConsumed.metadata.passConsumerMountGeneration} after=${passConsumed.metadata.passKeyStateAfterConsume}`);
  if (snapshot) details.push(`Handler entries: ${handlerEntries.length}`, `Run starts: ${runStarts.length}`, `Render-pending reentries: ${reentries.length}`);
  if (provenance) {
    details.push(
      `Event: trusted=${provenance.eventIsTrusted} type=${provenance.eventType} phase=${provenance.eventPhase}`,
      `User selections: ${provenance.userSelectionCount} event=${provenance.eventSequence}`,
      `Origin: ${provenance.programmaticChangeOrigin || "USER_OR_UNKNOWN"} sequence=${provenance.originSequence ?? "-"}`,
      `Instance: component=${provenance.componentInstanceId} listener=${provenance.listenerInstanceId} mount=${provenance.mountGeneration}`,
      `File fingerprint: ${provenance.fileFingerprint}`,
      `PASS: v3=${provenance.passKeyState} v2=${provenance.pdfNativeV2PassThroughState} native=${provenance.pdfNativePassThroughState}`,
      `PASS consumer: count=${provenance.passConsumerCount} component=${provenance.passConsumerComponentInstanceId || "-"} listener=${provenance.passConsumerListenerInstanceId || "-"} mount=${provenance.passConsumerMountGeneration ?? "-"}`,
      `Previous: run=${provenance.previousActiveRunId} checkpoint=${provenance.previousCheckpoint} terminal=${provenance.previousTerminalState}`
    );
  }
  if (reentry) {
    details.push(
      `Reentry: ${reentry.previousRunId} -> ${reentry.newRunId}`,
      `Previous instance: component=${reentry.previousComponentInstanceId} listener=${reentry.previousListenerInstanceId} mount=${reentry.previousMountGeneration}`,
      `New instance: component=${reentry.newComponentInstanceId} listener=${reentry.newListenerInstanceId} mount=${reentry.newMountGeneration}`
    );
  }
  box.textContent = [formatCertificatePdfDiagnosticSnapshot(snapshot), ...details].join("\n");
}

function showDebug(result, tokenCount) {
  const card = vehicleCard();
  if (!card) return;
  let details = card.querySelector("[data-pdf-structured-v3-debug]");
  if (!details) {
    details = document.createElement("details");
    details.dataset.pdfStructuredV3Debug = "1";
    details.style.marginTop = "12px";
    details.innerHTML = "<summary style='font-weight:800;cursor:pointer'>PDF構造読み取り v3 詳細（確認用）</summary><pre style='white-space:pre-wrap;word-break:break-word;max-height:520px;overflow:auto;background:#f8fafc;border-radius:10px;padding:10px;font-size:12px'></pre>";
    card.appendChild(details);
  }
  const pre = details.querySelector("pre");
  if (!pre) return;
  const rows = Object.entries(result.patch).map(([key, value]) => `${key}: ${value}`);
  pre.textContent = [
    `文字トークン: ${tokenCount}`,
    `構造取得: ${result.found}項目 / strong=${result.strong ? "YES" : "NO"}`,
    "",
    ...rows,
    "",
    "--- PDF構造行 ---",
    ...result.lines.map((line) => line.text),
  ].join("\n");
}

function showPreview(canvas) {
  const card = vehicleCard();
  if (!card) return;
  let img = card.querySelector("img[data-pdf-structured-v3-preview]");
  if (!img) {
    img = document.createElement("img");
    img.dataset.pdfStructuredV3Preview = "1";
    img.alt = "PDF車検証プレビュー";
    img.style.display = "block";
    img.style.width = "100%";
    img.style.maxHeight = "560px";
    img.style.objectFit = "contain";
    img.style.borderRadius = "14px";
    img.style.marginTop = "14px";
    img.style.background = "#f4f6fa";
    card.appendChild(img);
  }
  img.src = canvas.toDataURL("image/jpeg", 0.88);
}

function resetForm() {
  const button = Array.from(document.querySelectorAll("button")).find((candidate) => (candidate.textContent || "").includes("＋新規車両"));
  button?.click();
}

function applyPatch(ownership, runId, patch) {
  return commitCertificatePdfFinal({
    ownership,
    runId,
    patch,
    writePdf: (value) => { window[PDF_PRIORITY_KEY] = value; },
    clearQr: () => { window[QR_PRIORITY_KEY] = null; },
    dispatch: (value) => window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: value })),
  });
}

function passToExisting(input) {
  input.dataset[PASS_KEY] = "1";
  const changeEvent = markCertificatePdfV3FallbackEvent(new Event("change", { bubbles: true }));
  observeCertificatePdfProgrammaticChange(changeEvent, "V3_PASS_TO_EXISTING");
  input.dispatchEvent(changeEvent);
}

export default function CertificatePdfStructuredReaderV3() {
  useLayoutEffect(() => {
    // This reader is mounted by the vehicle form itself. Internal SPA navigation
    // can display the form before window.location reflects the route, so a
    // pathname gate would incorrectly disable native PDF handling.
    let dead = false;
    let activeDiagnosticId = null;
    let activeRenderContext = null;
    const mountGeneration = ++nextCertificatePdfMountGeneration;
    const componentInstanceId = `v3-component-${++nextCertificatePdfComponentInstanceId}`;
    const listenerInstanceId = `v3-listener-${++nextCertificatePdfListenerInstanceId}`;
    const observerIdentity = { componentInstanceId, listenerInstanceId, mountGeneration };
    const ownership = createCertificatePdfRunOwnership();
    const completion = createCertificatePdfCompletionContract(ownership);

    const cancelIfInactive = (runId, diagnosticId) => {
      if (!dead && completion.isActive(runId)) return false;
      completion.cancel(runId);
      terminalCertificatePdfFieldProvenance(diagnosticId, "cancelled");
      terminalCertificatePdfDiagnostic(diagnosticId, "cancelled");
      return true;
    };

    const fallback = (runId, diagnosticId, input, message, error = false) => {
      if (!completion.settle(runId, error ? "error" : "fallback")) return false;
      terminalCertificatePdfFieldProvenance(diagnosticId, error ? "error" : "fallback");
      terminalCertificatePdfDiagnostic(diagnosticId, error ? "error" : "fallback");
      showStatus(message, error);
      passToExisting(input);
      return true;
    };

    const unsubscribeDiagnostics = subscribeCertificatePdfDiagnostics(showDiagnostic);
    showCertificatePdfFieldProvenanceUi(getCertificatePdfDiagnosticSnapshot());

    const onChange = async (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;

      const file = input.files?.[0] || null;
      const previousRun = safeCertificatePdfPreviousRun();
      const handlerMetadata = safeCertificatePdfRunEntryMetadata(
        event,
        input,
        file,
        observerIdentity,
        previousRun
      );

      if (input.dataset[PASS_KEY] === "1") {
        safeCertificatePdfCheckpoint(activeDiagnosticId, "V3_HANDLER_ENTER", handlerMetadata);
        safeCertificatePdfCheckpoint(activeDiagnosticId, "V3_PASS_OBSERVED", {
          ...handlerMetadata,
          passKeyStateBeforeConsume: true,
          passKeyStateAfterConsume: true,
        });
        delete input.dataset[PASS_KEY];
        const passConsumer = observeCertificatePdfPassConsumer(event, observerIdentity);
        safeCertificatePdfCheckpoint(activeDiagnosticId, "V3_PASS_CONSUMED", {
          ...handlerMetadata,
          ...passConsumer,
          passKeyStateBeforeConsume: true,
          passKeyStateAfterConsume: safeCertificatePdfPassKeyState(input),
        });
        return;
      }
      // Another V3 listener may already have consumed the input's one-use PASS token.
      // The Event itself still belongs to the same fallback across every listener.
      if (isCertificatePdfV3FallbackEvent(event)) {
        safeCertificatePdfCheckpoint(activeDiagnosticId, "V3_HANDLER_ENTER", handlerMetadata);
        return;
      }
      // v2/v1 がフォールバック用に再送したイベントは横取りしない。
      if (input.dataset.pdfNativeV2PassThrough === "1" || input.dataset.pdfNativePassThrough === "1") {
        safeCertificatePdfCheckpoint(activeDiagnosticId, "V3_HANDLER_ENTER", handlerMetadata);
        return;
      }

      if (!file) {
        safeCertificatePdfCheckpoint(activeDiagnosticId, "V3_HANDLER_ENTER", handlerMetadata);
        return;
      }
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
      if (!isPdf) {
        safeCertificatePdfCheckpoint(activeDiagnosticId, "V3_HANDLER_ENTER", handlerMetadata);
        return;
      }
      if (!claimCertificatePdfV3Event(event)) {
        safeCertificatePdfCheckpoint(activeDiagnosticId, "V3_HANDLER_ENTER", handlerMetadata);
        return;
      }
      if (activeRenderContext && completion.isActive(activeRenderContext.runId)) {
        checkpointCertificatePdfDiagnostic(activeRenderContext.diagnosticId, "RUN_INVALIDATED_DURING_RENDER");
      }
      const runId = completion.beginRun();
      const runStartedMetadata = safeCertificatePdfRunEntryMetadata(
        event,
        input,
        file,
        observerIdentity,
        previousRun,
        runId
      );
      const diagnosticId = safeBeginCertificatePdfDiagnosticRun(runId, runStartedMetadata);
      activeDiagnosticId = diagnosticId;
      const fieldProvenanceEnabled = isCertificatePdfFieldProvenanceEnabled();
      if (fieldProvenanceEnabled) beginCertificatePdfFieldProvenance(diagnosticId, runId);
      safeCertificatePdfCheckpoint(diagnosticId, "V3_HANDLER_ENTER", runStartedMetadata);
      if (isCertificatePdfRenderPending(previousRun)) {
        safeCertificatePdfCheckpoint(diagnosticId, "RUN_REENTRY_WHILE_RENDER_PENDING", {
          previousRunId: previousRun.previousActiveRunId,
          newRunId: runId,
          previousComponentInstanceId: previousRun.previousComponentInstanceId,
          previousListenerInstanceId: previousRun.previousListenerInstanceId,
          previousMountGeneration: previousRun.previousMountGeneration,
          newComponentInstanceId: componentInstanceId,
          newListenerInstanceId: listenerInstanceId,
          newMountGeneration: mountGeneration,
          previousCheckpoint: previousRun.previousCheckpoint,
          previousTerminalState: previousRun.previousTerminalState,
          eventIsTrusted: Boolean(event?.isTrusted),
          fileFingerprint: safeCertificatePdfFileFingerprint(file),
        });
      }
      latestCertificatePdfProvenanceRun = {
        runId,
        diagnosticId,
        componentInstanceId,
        listenerInstanceId,
        mountGeneration,
      };

      // PDFはまずこのv3が判断する。十分に構造化できた時だけOCRを完全に止める。
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      showStatus("PDF構造読み取り v3: 文字レイヤーと表の行構造を解析中…");

      try {
        checkpointCertificatePdfDiagnostic(diagnosticId, "PDFJS_LOAD_STARTED");
        const pdfjs = await loadPdfJs();
        checkpointCertificatePdfDiagnostic(diagnosticId, "PDFJS_LOADED");
        const cfAcPreflightEnabled = isCertificatePdfCfAcPreflightEnabled();
        if (cfAcPreflightEnabled) await runCertificatePdfCfAcPreflight(file, pdfjs, diagnosticId);
        checkpointCertificatePdfDiagnostic(diagnosticId, "FILE_BUFFER_STARTED");
        const fileBuffer = await file.arrayBuffer();
        checkpointCertificatePdfDiagnostic(diagnosticId, "FILE_BUFFER_READY", { byteLength: fileBuffer.byteLength });
        if (cfAcPreflightEnabled) checkpointCertificatePdfDiagnostic(diagnosticId, "CF_MAIN_DOCUMENT_STARTED");
        checkpointCertificatePdfDiagnostic(diagnosticId, "DOCUMENT_LOAD_STARTED");
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(fileBuffer) }).promise;
        checkpointCertificatePdfDiagnostic(diagnosticId, "DOCUMENT_LOADED", { pageCount: pdf.numPages || 0 });
        try {
          checkpointCertificatePdfDiagnostic(diagnosticId, "PAGE_CHOOSE_STARTED");
          const capturedPages = fieldProvenanceEnabled ? new Map() : null;
          const chosen = await choosePage(pdf, capturedPages ? (pageNumber, items, pageResult) => {
            try { capturedPages.set(pageNumber, { items, tokens: pageResult }); } catch {}
          } : null);
          checkpointCertificatePdfDiagnostic(diagnosticId, "PAGE_CHOSEN", { pageNumber: chosen.pageNumber });
          checkpointCertificatePdfDiagnostic(diagnosticId, "TOKENS_LOAD_STARTED");
          const tokens = chosen.tokens.length ? chosen.tokens : await pageTokens(await pdf.getPage(chosen.pageNumber),
            capturedPages ? (items, pageResult) => { try { capturedPages.set(chosen.pageNumber, { items, tokens: pageResult }); } catch {} } : null);
          checkpointCertificatePdfDiagnostic(diagnosticId, "TOKENS_READY", { tokenCount: tokens.length });
          checkpointCertificatePdfDiagnostic(diagnosticId, "STRUCTURED_PARSE_STARTED");
          if (capturedPages?.has(chosen.pageNumber)) {
            const captured = capturedPages.get(chosen.pageNumber);
            observeCertificatePdfFieldRaw(diagnosticId, chosen.pageNumber, captured.items, tokens);
          }
          const lines = buildLines(tokens);
          if (fieldProvenanceEnabled) observeCertificatePdfFieldRows(diagnosticId, lines);
          const parsed = parseStructured(lines, fieldProvenanceEnabled ? (stage, input, candidate, output, provenance) =>
            observeCertificatePdfFieldStage(diagnosticId, stage, input, candidate, output, provenance) : null);
          if (fieldProvenanceEnabled) safeCertificatePdfCheckpoint(diagnosticId, "FIELD_PROVENANCE_READY", { fieldCount: Object.keys(getCertificatePdfFieldProvenance(diagnosticId)?.fields || {}).length });
          checkpointCertificatePdfDiagnostic(diagnosticId, "STRUCTURED_PARSED", { found: parsed.found, strong: parsed.strong });
          checkpointCertificatePdfDiagnostic(diagnosticId, "PAGE_RENDER_STARTED");
          const renderContext = { runId, diagnosticId };
          activeRenderContext = renderContext;
          let canvas;
          try {
            canvas = await renderPage(pdf, chosen.pageNumber, 1800, diagnosticId);
          } finally {
            if (activeRenderContext === renderContext) activeRenderContext = null;
          }
          checkpointCertificatePdfDiagnostic(diagnosticId, "PAGE_RENDERED", { width: canvas.width, height: canvas.height });
          checkpointCertificatePdfDiagnostic(diagnosticId, "QR_CHECK_STARTED");
          const qrFound = await hasQr(canvas);
          checkpointCertificatePdfDiagnostic(diagnosticId, "QR_CHECK_DONE", { qrFound });
          if (cancelIfInactive(runId, diagnosticId)) return;
          checkpointCertificatePdfDiagnostic(diagnosticId, "RUN_ACTIVE_CONFIRMED");

          showPreview(canvas);
          showDebug(parsed, tokens.length);

          if (qrFound) {
            fallback(runId, diagnosticId, input, `PDF ${chosen.pageNumber}ページ目: QRを検出。QR優先ルートへ引き継ぎます。`);
            return;
          }

          if (!parsed.strong) {
            fallback(runId, diagnosticId, input, `PDF構造読み取り v3: ${parsed.found}項目。構造確信度不足のため既存OCRへフォールバックします。`);
            return;
          }

          resetForm();
          checkpointCertificatePdfDiagnostic(diagnosticId, "FORM_RESET");
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (cancelIfInactive(runId, diagnosticId)) return;
          checkpointCertificatePdfDiagnostic(diagnosticId, "FINAL_COMMIT_STARTED");
          if (!applyPatch(ownership, runId, parsed.patch)) {
            if (fieldProvenanceEnabled) observeCertificatePdfFieldApply(diagnosticId, parsed.patch, false);
            fallback(runId, diagnosticId, input, "PDF構造読み取り v3: FINAL確定に失敗したため既存OCRへ切り替えます。", true);
            return;
          }
          if (fieldProvenanceEnabled) observeCertificatePdfFieldApply(diagnosticId, parsed.patch, true);
          checkpointCertificatePdfDiagnostic(diagnosticId, "FINAL_COMMITTED");
          if (!completion.settle(runId, "completed")) return;
          terminalCertificatePdfFieldProvenance(diagnosticId, "completed");
          if (fieldProvenanceEnabled) safeCertificatePdfCheckpoint(diagnosticId, "FIELD_PROVENANCE_APPLIED");
          terminalCertificatePdfDiagnostic(diagnosticId, "completed", { found: parsed.found });
          showStatus(`PDF構造読み取り v3 完了: OCR 0pass / ${parsed.found}項目をPDF文字から直接確定。既存OCRは実行していません。`);
          input.value = "";
        } finally {
          checkpointCertificatePdfDiagnostic(diagnosticId, "DOCUMENT_DESTROY_STARTED", { duringRender: activeRenderContext?.diagnosticId === diagnosticId });
          await pdf.destroy?.().catch?.(() => {});
          checkpointCertificatePdfDiagnostic(diagnosticId, "DOCUMENT_DESTROY_DONE");
        }
      } catch (error) {
        if (cancelIfInactive(runId, diagnosticId)) return;
        console.error("PDF structured v3", error);
        fallback(runId, diagnosticId, input, `PDF構造読み取り v3 エラー: ${error?.message || error}。既存OCRへ切り替えます。`, true);
      }
    };

    window.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      const cancelledRunId = completion.invalidate();
      if (cancelledRunId !== null) {
        terminalCertificatePdfFieldProvenance(activeDiagnosticId, "cancelled");
        terminalCertificatePdfDiagnostic(activeDiagnosticId, "cancelled");
        if (activeRenderContext?.diagnosticId === activeDiagnosticId) {
          checkpointCertificatePdfDiagnostic(activeDiagnosticId, "READER_UNMOUNTED_DURING_RENDER");
        }
        showStatus("PDF構造読み取り v3: 処理をキャンセルしました。", true);
      }
      unsubscribeDiagnostics();
      removeCertificatePdfFieldProvenanceUi();
      window.removeEventListener("change", onChange, true);
    };
  }, []);

  return null;
}
