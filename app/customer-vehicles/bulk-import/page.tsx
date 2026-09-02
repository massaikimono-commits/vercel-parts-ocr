/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMemo, useRef, useState } from "react";
import { supabase } from "../../supabase";
import { safeActionError } from "../../lib/client-security";
import { validateDocumentFile } from "../../lib/file-security";
import { parseVehicleCertificatePdfNative } from "../../certificate-pdf-native-reader-v2";

type CandidateStatus = "ready" | "review" | "error";

type Candidate = {
  id: string;
  fileName: string;
  selected: boolean;
  status: CandidateStatus;
  message: string;
  patch: Record<string, string>;
  customerName: string;
  customerAddress: string;
  registrationNumber: string;
  chassisNumber: string;
  maker: string;
  model: string;
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function digits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function last4FromRegistration(value: string) {
  return digits(value).slice(-4);
}

function eraDateToIso(value: string) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, "");
  const match = text.match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  const eraYear = match[2] === "元" ? 1 : Number(match[2]);
  const year =
    match[1] === "令和" ? 2018 + eraYear :
    match[1] === "平成" ? 1988 + eraYear :
    match[1] === "昭和" ? 1925 + eraYear : 0;
  if (!year) return null;
  return `${year}-${String(Number(match[3])).padStart(2, "0")}-${String(Number(match[4])).padStart(2, "0")}`;
}

function fuelType(value: string) {
  const text = String(value || "").normalize("NFKC");
  if (/軽油|ディーゼル/.test(text)) return "ディーゼル";
  if (/ハイブリッド|\bHV\b|ガソリン・電気/.test(text)) return "HV";
  if (/電気自動車|\bEV\b|^電気$/.test(text)) return "EV";
  if (/ガソリン|揮発油/.test(text)) return "ガソリン";
  return "その他";
}

function integerString(value: string) {
  const n = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? String(Math.trunc(n)) : "";
}

function candidateKey(candidate: Candidate) {
  const chassis = candidate.chassisNumber.normalize("NFKC").replace(/[\s　]+/g, "").toUpperCase();
  const registration = candidate.registrationNumber.normalize("NFKC").replace(/[\s　・･]+/g, "").toUpperCase();
  return chassis ? "C:" + chassis : registration ? "R:" + registration : "";
}

export default function CustomerVehicleBulkImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("複数の車検証PDFをまとめて選択できます。読み取り後に一覧を確認してから登録します。");

  const selectedCount = useMemo(() => candidates.filter((x) => x.selected).length, [candidates]);
  const readyCount = useMemo(() => candidates.filter((x) => x.status === "ready").length, [candidates]);
  const reviewCount = useMemo(() => candidates.filter((x) => x.status === "review").length, [candidates]);

  function updateCandidate(id: string, patch: Partial<Candidate>) {
    setCandidates((old) => old.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  async function chooseFiles(files: FileList | null) {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (list.length > 100) {
      setMessage("一度に選べるPDFは100件までです。100件ずつ分けて取り込んでください。");
      return;
    }

    setBusy(true);
    setMessage(`${list.length}件のPDFを順番に解析しています…`);
    const next: Candidate[] = [];

    for (let index = 0; index < list.length; index += 1) {
      const file = list[index];
      setMessage(`${list.length}件中 ${index + 1}件目を解析中：${file.name}`);

      const check = await validateDocumentFile(file, { allowPdf: true });
      if (!check.ok || check.kind !== "pdf") {
        next.push({
          id: uid(),
          fileName: file.name,
          selected: false,
          status: "error",
          message: check.ok ? "PDFを選択してください。" : check.message,
          patch: {},
          customerName: "",
          customerAddress: "",
          registrationNumber: "",
          chassisNumber: "",
          maker: "",
          model: "",
        });
        continue;
      }

      try {
        const parsed: any = await parseVehicleCertificatePdfNative(file);
        const patch = (parsed?.patch || {}) as Record<string, string>;
        const customerName = String(patch.userName || "").trim();
        const customerAddress = String(patch.userAddress || "").trim();
        const registrationNumber = String(patch.registrationNumber || "").trim();
        const chassisNumber = String(patch.chassisNumber || "").trim();
        const basicReady = Boolean(customerName && (registrationNumber || chassisNumber));
        const confident = Boolean(parsed?.confident);

        next.push({
          id: uid(),
          fileName: file.name,
          selected: basicReady && confident,
          status: basicReady && confident ? "ready" : "review",
          message: basicReady && confident
            ? `直接取得 ${parsed?.totalCount || 0}項目 / ${parsed?.pageCount || 1}ページ中${parsed?.pageNumber || 1}ページ目`
            : "必要項目が不足しています。お客様名・登録番号/車台番号を確認して補完してください。",
          patch,
          customerName,
          customerAddress,
          registrationNumber,
          chassisNumber,
          maker: String(patch.vehicleName || "").trim(),
          model: String(patch.model || "").trim(),
        });
      } catch (error: any) {
        next.push({
          id: uid(),
          fileName: file.name,
          selected: false,
          status: "error",
          message: error?.message || "PDFを解析できませんでした。",
          patch: {},
          customerName: "",
          customerAddress: "",
          registrationNumber: "",
          chassisNumber: "",
          maker: "",
          model: "",
        });
      }
    }

    setCandidates(next);
    setBusy(false);
    setMessage(`解析完了：登録候補 ${next.filter((x) => x.status === "ready").length}件 / 要確認 ${next.filter((x) => x.status === "review").length}件 / エラー ${next.filter((x) => x.status === "error").length}件`);
  }

  function markCandidateAfterEdit(id: string) {
    setCandidates((old) => old.map((row) => {
      if (row.id !== id) return row;
      if (row.status === "error") return row;
      const valid = Boolean(row.customerName.trim() && (row.registrationNumber.trim() || row.chassisNumber.trim()));
      return {
        ...row,
        status: valid ? "ready" : "review",
        selected: valid ? row.selected : false,
        message: valid ? "手動確認済み。登録候補として選択できます。" : "お客様名と登録番号または車台番号が必要です。",
      };
    }));
  }

  async function importSelected() {
    const selected = candidates.filter((row) => row.selected);
    if (!selected.length) {
      setMessage("登録するPDFを1件以上選択してください。");
      return;
    }

    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const row of selected) {
      const key = candidateKey(row);
      if (!key) continue;
      if (seen.has(key)) duplicates.push(row.fileName);
      seen.add(key);
    }
    if (duplicates.length) {
      setMessage(`同じ車両と思われるPDFが重複しています：${duplicates.join("、")}。重複分のチェックを外してください。`);
      return;
    }

    const invalid = selected.filter((row) => !row.customerName.trim() || (!row.registrationNumber.trim() && !row.chassisNumber.trim()));
    if (invalid.length) {
      setMessage("選択中に必要項目が不足しているPDFがあります。お客様名・登録番号/車台番号を確認してください。");
      return;
    }

    setSaving(true);
    setMessage(`${selected.length}件をまとめて登録しています…`);
    try {
      const items = selected.map((row) => ({
        fileName: row.fileName,
        customerName: row.customerName.trim(),
        customerAddress: row.customerAddress.trim() || null,
        registrationNumber: row.registrationNumber.trim() || null,
        registrationLast4: last4FromRegistration(row.registrationNumber) || null,
        chassisNumber: row.chassisNumber.trim() || null,
        maker: row.maker.trim() || null,
        model: row.model.trim() || null,
        fuelType: fuelType(row.patch.fuel || ""),
        vehicleWeightKg: integerString(row.patch.vehicleWeightKg || ""),
        firstRegistration: String(row.patch.firstRegistration || "").trim() || null,
        inspectionExpiryDate: eraDateToIso(row.patch.inspectionExpiry || ""),
        engineModel: String(row.patch.engineModel || "").trim() || null,
        usageCategory: String(row.patch.purpose || "").trim() || null,
        bodyType: String(row.patch.bodyShape || "").trim() || null,
        grossVehicleWeightKg: integerString(row.patch.grossVehicleWeightKg || ""),
        curbWeightKg: integerString(row.patch.vehicleWeightKg || ""),
        seatingCapacity: integerString(row.patch.seatingCapacity || ""),
        documentNumber: String(row.patch.documentNumber || "").trim() || null,
        frontFrontAxleWeightKg: integerString(row.patch.frontFrontAxleWeightKg || ""),
        frontRearAxleWeightKg: integerString(row.patch.frontRearAxleWeightKg || ""),
        rearFrontAxleWeightKg: integerString(row.patch.rearFrontAxleWeightKg || ""),
        rearRearAxleWeightKg: integerString(row.patch.rearRearAxleWeightKg || ""),
        certificateFields: row.patch,
      }));

      const { data, error } = await supabase.rpc("import_vehicle_certificates_batch_v1", {
        p_items: items,
      });
      if (error) throw error;
      if (!data?.imported) throw new Error("一括登録を完了できませんでした。");

      setMessage(
        `${data?.itemCount || selected.length}件を登録しました。新規顧客 ${data?.createdCustomers || 0}件・新規車両 ${data?.insertedVehicles || 0}台・既存車両更新 ${data?.updatedVehicles || 0}台。`
      );
      setCandidates((old) => old.map((row) => row.selected ? { ...row, selected: false, message: "登録済み" } : row));
    } catch (error: any) {
      setMessage(safeActionError("PDF一括登録", error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <header className="top">
        <button onClick={() => location.assign("/customer-vehicles")}>← 顧客・車両管理へ</button>
        <strong>icb</strong>
      </header>

      <section className="card">
        <div className="eyebrow">移行・一括登録</div>
        <h1>車検証PDFをまとめて登録</h1>
        <p>
          複数のPDFを一度に選び、車検証の文字レイヤーからお客様・車両情報を読み取ります。
          解析後に一覧で確認してから、選択した分だけまとめて登録します。
        </p>
        <div className="notice">{busy || saving ? "処理中… " : ""}{message}</div>

        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={(event) => {
            void chooseFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <div className="actions">
          <button className="primary" disabled={busy || saving} onClick={() => inputRef.current?.click()}>
            📄 複数PDFを選択
          </button>
          <button disabled={busy || saving || selectedCount === 0} onClick={() => void importSelected()}>
            選択した {selectedCount}件をまとめて登録
          </button>
        </div>

        <div className="summary">
          <div><small>登録候補</small><b>{readyCount}</b></div>
          <div><small>要確認</small><b>{reviewCount}</b></div>
          <div><small>選択中</small><b>{selectedCount}</b></div>
        </div>
      </section>

      {!!candidates.length && (
        <section className="list">
          {candidates.map((row) => (
            <article key={row.id} className={`card candidate ${row.status}`}>
              <div className="candidateHead">
                <label className="selectCheck">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    disabled={row.status === "error"}
                    onChange={(event) => updateCandidate(row.id, { selected: event.target.checked })}
                  />
                  登録する
                </label>
                <span className="status">{row.status === "ready" ? "登録候補" : row.status === "review" ? "要確認" : "エラー"}</span>
              </div>

              <h2>{row.fileName}</h2>
              <p className="rowMessage">{row.message}</p>

              <div className="grid">
                <label>お客様名
                  <input
                    value={row.customerName}
                    disabled={row.status === "error"}
                    onChange={(event) => updateCandidate(row.id, { customerName: event.target.value })}
                    onBlur={() => markCandidateAfterEdit(row.id)}
                  />
                </label>
                <label>住所
                  <input
                    value={row.customerAddress}
                    disabled={row.status === "error"}
                    onChange={(event) => updateCandidate(row.id, { customerAddress: event.target.value })}
                  />
                </label>
                <label>登録番号
                  <input
                    value={row.registrationNumber}
                    disabled={row.status === "error"}
                    onChange={(event) => updateCandidate(row.id, { registrationNumber: event.target.value })}
                    onBlur={() => markCandidateAfterEdit(row.id)}
                  />
                </label>
                <label>車台番号
                  <input
                    value={row.chassisNumber}
                    disabled={row.status === "error"}
                    onChange={(event) => updateCandidate(row.id, { chassisNumber: event.target.value })}
                    onBlur={() => markCandidateAfterEdit(row.id)}
                  />
                </label>
                <label>メーカー
                  <input value={row.maker} disabled={row.status === "error"} onChange={(event) => updateCandidate(row.id, { maker: event.target.value })} />
                </label>
                <label>型式
                  <input value={row.model} disabled={row.status === "error"} onChange={(event) => updateCandidate(row.id, { model: event.target.value })} />
                </label>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="card caution">
        <b>一括登録の安全ルール</b>
        <p>
          同じ車台番号または登録番号の車両が既にある場合は新しい車両を増やさず更新します。
          同名のお客様でも住所が違う場合は別のお客様として扱い、誤って統合しないようにします。
          文字情報が不足したPDFは自動登録せず「要確認」に止めます。
        </p>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        button,input{font:inherit}.page{max-width:1100px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
        button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:12px;padding:11px 14px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:20px;margin-bottom:14px}
        .eyebrow{font-weight:900;color:#2674e8}.card h1{font-size:30px;margin:4px 0 8px}.card p{line-height:1.65;color:#5e6b7d}.notice{background:#eef6ff;border:1px solid #c8daf6;border-radius:12px;padding:12px 14px;margin:12px 0;color:#385c8d}
        .hidden{display:none}.actions{display:flex;gap:9px;flex-wrap:wrap}.actions button{flex:1 1 260px}.primary{background:#2f6fe4;color:#fff;border-color:#2f6fe4}
        .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.summary>div{background:#f7f9fc;border-radius:12px;padding:10px;display:grid}.summary small{color:#718096}.summary b{font-size:24px}
        .list{display:grid;gap:12px}.candidate{margin-bottom:0}.candidate.ready{border-color:#b8dcc4}.candidate.review{border-color:#e5c277}.candidate.error{border-color:#e5b0aa;background:#fff9f8}
        .candidateHead{display:flex;justify-content:space-between;align-items:center}.selectCheck{display:flex;gap:7px;align-items:center;font-weight:800}.selectCheck input{width:auto}.status{font-size:12px;font-weight:900;border-radius:999px;padding:5px 9px;background:#f0f3f7}.candidate.ready .status{background:#eaf7ee;color:#24713d}.candidate.review .status{background:#fff6df;color:#87610c}.candidate.error .status{background:#ffeceb;color:#a13b32}
        .candidate h2{font-size:18px;margin:10px 0 4px;word-break:break-all}.rowMessage{margin:0 0 12px!important;font-size:13px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.grid label{display:grid;gap:5px;font-size:12px;font-weight:800;color:#607086}.grid input{width:100%;border:1px solid #cbd6e3;border-radius:10px;padding:10px;color:#172033;background:#fff}
        .caution{background:#fffdf6;border-color:#eadca6}.caution p{margin-bottom:0}
        @media(max-width:650px){.grid{grid-template-columns:1fr}.summary{grid-template-columns:1fr 1fr 1fr}.card{padding:16px}.page{padding-left:10px;padding-right:10px}.card h1{font-size:25px}}
      `}</style>
    </main>
  );
}
