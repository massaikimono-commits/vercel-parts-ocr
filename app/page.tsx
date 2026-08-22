/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";

type Part = {
  id: string;
  name: string;
  qty: string;
  retail: string;
  cost: string;
  source?: string;
};

type Vehicle = {
  number: string;
  model: string;
  type: "EV" | "ガソリン" | "HV" | "その他";
  weight: string;
  registration: string;
  last4: string;
  chassis: string;
  firstRegistration: string;
  customerId: string;
};

type Customer = {
  id: string;
  type: "individual" | "company";
  name: string;
  companyName: string;
  phone: string;
  email: string;
  postalCode: string;
  address: string;
  notes: string;
};

type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type Template = {
  widthMm: number;
  heightMm: number;
  fields: {
    name: Box;
    qty: Box;
    retail: Box;
    cost: Box;
  };
};

const initialTemplate: Template = {
  widthMm: 210,
  heightMm: 297,
  fields: {
    name: { x: 45, y: 28, w: 42, h: 5 },
    qty: { x: 89, y: 28, w: 9, h: 5 },
    retail: { x: 102, y: 28, w: 18, h: 5 },
    cost: { x: 122, y: 28, w: 18, h: 5 },
  },
};

const uid = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

const money = (s: string) => s.replace(/[^\d.-]/g, "");

function parseOCR(text: string): Part[] {
  const out: Part[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();

    if (!line) continue;

    const c = line
      .split(/[,\t，|]+/)
      .map((x) => x.trim())
      .filter(Boolean);

    if (c.length < 4) continue;

    const n = c.slice(1).filter((x) => /\d/.test(x));

    if (n.length >= 3) {
      out.push({
        id: uid(),
        name: c[0],
        qty: n[0].replace(/[^\d.-]/g, ""),
        retail: money(n[1]),
        cost: money(n[2]),
        source: line,
      });
    }
  }

  return out;
}

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ログインはメールアドレスを画面に出さずID方式
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [authMsg, setAuthMsg] = useState("");

  const [tab, setTab] = useState<
    "vehicle" | "customerVehicle" | "ocr" | "data" | "print" | "settings"
  >("vehicle");

  const emptyVehicle: Vehicle = {
    number: "",
    model: "",
    type: "EV",
    weight: "",
    registration: "",
    last4: "",
    chassis: "",
    firstRegistration: "",
    customerId: "",
  };

  const [vehicle, setVehicle] = useState<Vehicle>(emptyVehicle);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const emptyCustomer: Customer = {
    id: "",
    type: "individual",
    name: "",
    companyName: "",
    phone: "",
    email: "",
    postalCode: "",
    address: "",
    notes: "",
  };

  const [customer, setCustomer] = useState<Customer>(emptyCustomer);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [customerSearch, setCustomerSearch] = useState("");
  const [registrationSearch, setRegistrationSearch] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");

  const [parts, setParts] = useState<Part[]>([]);
  const [ocrText, setOcrText] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");

  const [template, setTemplate] =
    useState<Template>(initialTemplate);

  const [guide, setGuide] = useState("");
  const [printCount, setPrintCount] = useState(10);
  const [selected, setSelected] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setAuthLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    try {
      const p = localStorage.getItem("parts-data");
      if (p) setParts(JSON.parse(p));

      const t = localStorage.getItem("parts-template");
      if (t) setTemplate(JSON.parse(t));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("parts-data", JSON.stringify(parts));
  }, [parts]);

  useEffect(() => {
    localStorage.setItem(
      "parts-template",
      JSON.stringify(template)
    );
  }, [template]);

  useEffect(() => {
    if (!session) return;

    (async () => {
      const [{ data: cs }, { data: vs }] =
        await Promise.all([
          supabase
            .from("customers")
            .select("*")
            .order("created_at", { ascending: false }),

          supabase
            .from("vehicles")
            .select("*")
            .order("created_at", { ascending: false }),
        ]);

      if (cs) {
        setCustomers(
          cs.map((c: any) => ({
            id: c.id,
            type: c.customer_type,
            name: c.name,
            companyName: c.company_name || "",
            phone: c.phone || "",
            email: c.email || "",
            postalCode: c.postal_code || "",
            address: c.address || "",
            notes: c.notes || "",
          }))
        );
      }

      if (vs) {
        setVehicles(
          vs.map(
            (v: any) =>
              ({
                number: v.vehicle_number,
                model: v.model || "",
                type: (v.fuel_type ||
                  "その他") as Vehicle["type"],
                weight:
                  v.vehicle_weight == null
                    ? ""
                    : String(v.vehicle_weight),
                registration: v.registration_number || "",
                last4:
                  v.registration_number_last4 || "",
                chassis: v.chassis_number || "",
                firstRegistration:
                  v.first_registration || "",
                customerId: v.customer_id || "",
                id: v.id,
              }) as any
          )
        );
      }
    })();
  }, [session]);

  const filtered = useMemo(
    () =>
      vehicles.filter(
        (v) =>
          !vehicleSearch ||
          v.number.includes(vehicleSearch) ||
          v.model.includes(vehicleSearch)
      ),
    [vehicles, vehicleSearch]
  );

  const customerFiltered = useMemo(
    () =>
      customers.filter(
        (c) =>
          !customerSearch ||
          c.name.includes(customerSearch) ||
          c.companyName.includes(customerSearch) ||
          c.phone.includes(customerSearch)
      ),
    [customers, customerSearch]
  );

  const registrationFiltered = useMemo(
    () =>
      vehicles.filter(
        (v) =>
          !registrationSearch ||
          v.last4 ===
            registrationSearch.trim().slice(-4)
      ),
    [vehicles, registrationSearch]
  );

  async function saveVehicle() {
    if (!vehicle.number.trim()) {
      setMsg("車体番号を入力してください。");
      return;
    }

    if (!session) {
      setMsg("ログインしてください。");
      return;
    }

    const normalized = {
  ...vehicle,
  number: vehicle.number.trim(),
  model: vehicle.model.trim(),
  registration: vehicle.registration.trim(),
  chassis: vehicle.chassis.trim(),
  firstRegistration: vehicle.firstRegistration.trim(),
  weight: vehicle.weight.trim(),
  customerId: vehicle.customerId.trim(),
  last4: (
    vehicle.registration
      .replace(/\D/g, "")
      .slice(-4) || vehicle.last4
  ).slice(-4),
};

   const payload = {
  vehicle_number: normalized.number,
  registration_number: normalized.registration || null,
  model: normalized.model || null, 
      fuel_type: normalized.type,
      vehicle_weight: normalized.weight
        ? Number(normalized.weight)
        : null,
      customer_id: normalized.customerId || null,
      chassis_number: normalized.chassis || null,
      first_registration:
        normalized.firstRegistration || null,
      registration_number_last4:
        normalized.last4 || null,
      updated_at: new Date().toISOString(),
    };

    const existing = (vehicle as any).id;

    const { data, error } = existing
      ? await supabase
          .from("vehicles")
          .update(payload)
          .eq("id", existing)
          .select()
          .single()
      : await supabase
          .from("vehicles")
          .insert(payload)
          .select()
          .single();

    if (error) {
      setMsg(`車両保存エラー: ${error.message}`);
      return;
    }

    const saved: any = {
      ...normalized,
      id: data.id,
    };

    setVehicles((v) =>
      [
        saved,
        ...v.filter(
          (x: any) => x.number !== saved.number
        ),
      ].slice(0, 500)
    );

    setVehicle(saved);
    setMsg("車両情報を保存しました。");
  }

  async function saveCustomer() {
    if (
      !customer.name.trim() &&
      !customer.companyName.trim()
    ) {
      setMsg(
        "顧客名または会社名を入力してください。"
      );
      return;
    }

    if (!session) {
      setMsg("ログインしてください。");
      return;
    }

    const payload = {
      customer_type: customer.type,
      name: customer.name || customer.companyName,
      company_name: customer.companyName || null,
      phone: customer.phone || null,
      email: customer.email || null,
      postal_code: customer.postalCode || null,
      address: customer.address || null,
      notes: customer.notes || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = customer.id
      ? await supabase
          .from("customers")
          .update(payload)
          .eq("id", customer.id)
          .select()
          .single()
      : await supabase
          .from("customers")
          .insert(payload)
          .select()
          .single();

    if (error) {
      setMsg(`顧客保存エラー: ${error.message}`);
      return;
    }

    const saved = {
      ...customer,
      id: data.id,
    };

    setCustomers((c) =>
      [
        saved,
        ...c.filter((x) => x.id !== saved.id),
      ].slice(0, 500)
    );

    setCustomer(saved);
    setMsg("顧客情報を保存しました。");
  }

  function newCustomer() {
  setCustomer({ ...emptyCustomer });
}

  function newVehicle() {
    setVehicle(emptyVehicle);
  }

  async function doOCR(file: File) {
    setOcrBusy(true);
    setProgress(0);
    setMsg("");

    try {
      const { createWorker } =
        await import("tesseract.js");

      const worker = await createWorker(
        "jpn+eng",
        1,
        {
          logger: (m) => {
            if (m.status === "recognizing text") {
              setProgress(
                Math.round((m.progress || 0) * 100)
              );
            }
          },
        }
      );

      const r = await worker.recognize(file);

      await worker.terminate();

      setOcrText(r.data.text);

      const found = parseOCR(r.data.text);

      if (found.length) {
        setParts((p) => [...found, ...p]);
      }

      setMsg(
        found.length
          ? `${found.length}件を追加しました。必ず内容を確認してください。`
          : "OCR結果を確認してください。表形式の伝票は手修正が必要な場合があります。"
      );
    } catch {
      setMsg(
        "OCRに失敗しました。明るく真上から撮影して再試行してください。"
      );
    } finally {
      setOcrBusy(false);
    }
  }

  function updatePart(
    id: string,
    key: keyof Part,
    val: string
  ) {
    setParts((p) =>
      p.map((x) =>
        x.id === id
          ? { ...x, [key]: val }
          : x
      )
    );
  }

  function copyTSV() {
    const s = [
      "部品名称\t個数\t定価\t仕入れ",
      ...parts.map(
        (p) =>
          `${p.name}\t${p.qty}\t${p.retail}\t${p.cost}`
      ),
    ].join("\n");

    navigator.clipboard?.writeText(s);

    setMsg(
      "Excel貼り付け用データをコピーしました。"
    );
  }

  function csv() {
    const s = [
      ["部品名称", "個数", "定価", "仕入れ"],
      ...parts.map((p) => [
        p.name,
        p.qty,
        p.retail,
        p.cost,
      ]),
    ]
      .map((r) =>
        r
          .map(
            (x) =>
              `"${String(x).replaceAll(
                '"',
                '""'
              )}"`
          )
          .join(",")
      )
      .join("\n");

    const a = document.createElement("a");

    a.href = URL.createObjectURL(
      new Blob(["\ufeff" + s], {
        type: "text/csv;charset=utf-8",
      })
    );

    a.download = "parts.csv";
    a.click();
  }

  function setBox(
    f: "name" | "qty" | "retail" | "cost",
    k: keyof Box,
    v: string
  ) {
    setTemplate((t) => ({
      ...t,
      fields: {
        ...t.fields,
        [f]: {
          ...t.fields[f],
          [k]: Number(v),
        },
      },
    }));
  }

  function importGuide(file: File) {
    const r = new FileReader();

    r.onload = () =>
      setGuide(String(r.result || ""));

    r.readAsDataURL(file);
  }

  const active = parts.find(
    (p) => p.id === selected
  );

  if (authLoading) {
    return (
      <main>
        <section className="card">
          <h1>読み込み中…</h1>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main>
        <header className="header">
          <div
            className="title"
            style={{
              fontSize: "42px",
              fontWeight: 800,
            }}
          >
            icb
          </div>
        </header>

        <section className="card">
          <h1>ログイン</h1>

          <input
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="ログインID"
            value={loginId}
            onChange={(e) =>
              setLoginId(e.target.value)
            }
          />

          <input
            type="password"
            placeholder="パスワード"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
          />

          <div className="actions">
            <button
              className="primary"
              onClick={async () => {
                setAuthMsg("");

                const id = loginId
                  .trim()
                  .toLowerCase();

                if (!id) {
                  setAuthMsg(
                    "ログインIDを入力してください。"
                  );
                  return;
                }

                if (!password) {
                  setAuthMsg(
                    "パスワードを入力してください。"
                  );
                  return;
                }

                const internalEmail =
                  `${id}@icb.local`;

                const { error } =
                  await supabase.auth.signInWithPassword({
                    email: internalEmail,
                    password,
                  });

                if (error) {
  setAuthMsg("ログインIDまたはパスワードが違います。");
  return;
}
              }}
            >
              ログイン
            </button>
          </div>

          {authMsg && (
            <div className="notice">
              {authMsg}
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="header">
        <div className="title">
          icb
        </div>

        <div className="desc">
          部品伝票OCR・車両管理・印刷
        </div>
      </header>

      <nav className="tabs">
        {(
          [
            ["vehicle", "①車体番号"],
            [
              "customerVehicle",
              "⑤顧客・車両管理",
            ],
            ["ocr", "②伝票OCR"],
            ["data", "③データ"],
            ["print", "④印刷"],
            ["settings", "⑥印刷位置設定"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={
              tab === id
                ? "tab active"
                : "tab"
            }
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="actions noPrint">
        <button
          onClick={async () => {
            await supabase.auth.signOut();
          }}
        >
          ログアウト
        </button>
      </div>

      {msg && (
        <div className="notice">{msg}</div>
      )}

      {tab === "vehicle" && (
        <section className="card">
          <h1>車体番号</h1>

          <input
            placeholder="車体番号"
            value={vehicle.number}
            onChange={(e) =>
              setVehicle({
                ...vehicle,
                number: e.target.value,
              })
            }
          />

          <input
            placeholder="型式"
            value={vehicle.model}
            onChange={(e) =>
              setVehicle({
                ...vehicle,
                model: e.target.value,
              })
            }
          />

          <select
            value={vehicle.type}
            onChange={(e) =>
              setVehicle({
                ...vehicle,
                type: e.target
                  .value as Vehicle["type"],
              })
            }
          >
            <option>EV</option>
            <option>ガソリン</option>
            <option>HV</option>
            <option>その他</option>
          </select>

          <input
            inputMode="numeric"
            placeholder="車両重量 kg"
            value={vehicle.weight}
            onChange={(e) =>
              setVehicle({
                ...vehicle,
                weight: e.target.value,
              })
            }
          />

          <button
            className="primary"
            onClick={saveVehicle}
          >
            保存
          </button>

          <hr />

          <input
            placeholder="車体番号で検索"
            value={vehicleSearch}
            onChange={(e) =>
              setVehicleSearch(e.target.value)
            }
          />

          <div className="list">
            {filtered.map((v, i) => (
              <button
                className="row"
                key={i}
                onClick={() =>
                  setVehicle(v)
                }
              >
                {v.number}　{v.model}　
                {v.type}
              </button>
            ))}
          </div>

          {!filtered.length && (
            <div className="empty">
              車両未選択
            </div>
          )}

          <button
            onClick={() => setTab("ocr")}
          >
            次へ：伝票OCR →
          </button>
        </section>
      )}

      {tab === "customerVehicle" && (
        <section className="card">
          <h1>顧客・車両管理</h1>

          <p>
            顧客と車両を登録し、車両を顧客に紐付けます。
            登録番号の下4桁でも検索できます。
          </p>

          <div className="manage-grid">
            <div className="subcard">
              <h2>顧客登録</h2>

              <select
                value={customer.type}
                onChange={(e) =>
                  setCustomer({
                    ...customer,
                    type: e.target
                      .value as Customer["type"],
                  })
                }
              >
                <option value="individual">
                  個人
                </option>
                <option value="company">
                  法人
                </option>
              </select>

              <input
                placeholder="顧客名"
                value={customer.name}
                onChange={(e) =>
                  setCustomer({
                    ...customer,
                    name: e.target.value,
                  })
                }
              />

              <input
                placeholder="会社名（法人の場合）"
                value={customer.companyName}
                onChange={(e) =>
                  setCustomer({
                    ...customer,
                    companyName:
                      e.target.value,
                  })
                }
              />

              <input
                inputMode="tel"
                placeholder="電話番号"
                value={customer.phone}
                onChange={(e) =>
                  setCustomer({
                    ...customer,
                    phone: e.target.value,
                  })
                }
              />

              <input
                type="email"
                placeholder="メールアドレス"
                value={customer.email}
                onChange={(e) =>
                  setCustomer({
                    ...customer,
                    email: e.target.value,
                  })
                }
              />

              <input
                inputMode="numeric"
                placeholder="郵便番号"
                value={customer.postalCode}
                onChange={(e) =>
                  setCustomer({
                    ...customer,
                    postalCode:
                      e.target.value,
                  })
                }
              />

              <input
                placeholder="住所"
                value={customer.address}
                onChange={(e) =>
                  setCustomer({
                    ...customer,
                    address: e.target.value,
                  })
                }
              />

              <textarea
                placeholder="備考"
                value={customer.notes}
                onChange={(e) =>
                  setCustomer({
                    ...customer,
                    notes: e.target.value,
                  })
                }
              />

              <div className="actions">
                <button
                  className="primary"
                  onClick={saveCustomer}
                >
                  顧客を保存
                </button>

                <button
                  onClick={newCustomer}
                >
                  新規
                </button>
              </div>

              <input
                placeholder="顧客名・会社名・電話番号で検索"
                value={customerSearch}
                onChange={(e) =>
                  setCustomerSearch(
                    e.target.value
                  )
                }
              />

              <div className="list">
                {customerFiltered.map(
                  (c) => (
                    <button
                      className="row"
                      key={c.id}
                      onClick={() =>
                        setCustomer(c)
                      }
                    >
                      {c.companyName ||
                        c.name}
                      　{c.phone}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="subcard">
              <h2>車両登録</h2>

              <input
                placeholder="車体番号"
                value={vehicle.number}
                onChange={(e) =>
                  setVehicle({
                    ...vehicle,
                    number: e.target.value,
                  })
                }
              />

              <input
                placeholder="登録番号（ナンバー）"
                value={
                  vehicle.registration
                }
                onChange={(e) =>
                  setVehicle({
                    ...vehicle,
                    registration:
                      e.target.value,
                    last4: e.target.value
                      .replace(/\D/g, "")
                      .slice(-4),
                  })
                }
              />

              <input
                inputMode="numeric"
                maxLength={4}
                placeholder="登録番号 下4桁"
                value={vehicle.last4}
                onChange={(e) =>
                  setVehicle({
                    ...vehicle,
                    last4: e.target.value
                      .replace(/\D/g, "")
                      .slice(-4),
                  })
                }
              />

              <input
                placeholder="車台番号"
                value={vehicle.chassis}
                onChange={(e) =>
                  setVehicle({
                    ...vehicle,
                    chassis: e.target.value,
                  })
                }
              />

              <input
                placeholder="型式"
                value={vehicle.model}
                onChange={(e) =>
                  setVehicle({
                    ...vehicle,
                    model: e.target.value,
                  })
                }
              />

              <select
                value={vehicle.type}
                onChange={(e) =>
                  setVehicle({
                    ...vehicle,
                    type: e.target
                      .value as Vehicle["type"],
                  })
                }
              >
                <option>EV</option>
                <option>ガソリン</option>
                <option>HV</option>
                <option>その他</option>
              </select>

              <input
                placeholder="初度登録"
                value={
                  vehicle.firstRegistration
                }
                onChange={(e) =>
                  setVehicle({
                    ...vehicle,
                    firstRegistration:
                      e.target.value,
                  })
                }
              />

              <input
                inputMode="numeric"
                placeholder="車両重量 kg"
                value={vehicle.weight}
                onChange={(e) =>
                  setVehicle({
                    ...vehicle,
                    weight: e.target.value,
                  })
                }
              />

              <select
                value={vehicle.customerId}
                onChange={(e) =>
                  setVehicle({
                    ...vehicle,
                    customerId:
                      e.target.value,
                  })
                }
              >
                <option value="">
                  顧客を選択
                </option>

                {customers.map((c) => (
                  <option
                    key={c.id}
                    value={c.id}
                  >
                    {c.companyName ||
                      c.name}
                  </option>
                ))}
              </select>

              <div className="actions">
                <button
                  className="primary"
                  onClick={saveVehicle}
                >
                  車両を保存
                </button>

                <button
                  onClick={newVehicle}
                >
                  新規
                </button>
              </div>

              <input
                inputMode="numeric"
                maxLength={4}
                placeholder="登録番号下4桁で検索"
                value={
                  registrationSearch
                }
                onChange={(e) =>
                  setRegistrationSearch(
                    e.target.value
                      .replace(/\D/g, "")
                      .slice(-4)
                  )
                }
              />

              <div className="list">
                {registrationFiltered.map(
                  (v) => {
                    const c =
                      customers.find(
                        (x) =>
                          x.id ===
                          v.customerId
                      );

                    return (
                      <button
                        className="row"
                        key={v.number}
                        onClick={() =>
                          setVehicle(v)
                        }
                      >
                        {v.registration ||
                          v.number}
                        　{v.model}　
                        {c?.companyName ||
                          c?.name ||
                          "顧客未登録"}
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "ocr" && (
        <section className="card">
          <h1>部品伝票OCR</h1>

          <p>
            iPhoneで伝票を撮影してください。
            1回の撮影から複数部品を候補抽出し、
            部品名称・個数・定価・仕入れを編集できます。
          </p>

          <input
            ref={fileRef}
            hidden
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) =>
              e.target.files?.[0] &&
              doOCR(e.target.files[0])
            }
          />

          <button
            className="primary big"
            disabled={ocrBusy}
            onClick={() =>
              fileRef.current?.click()
            }
          >
            {ocrBusy
              ? `OCR中 ${progress}%`
              : "📷 部品伝票を撮影・読み込む"}
          </button>

          <textarea
            value={ocrText}
            onChange={(e) =>
              setOcrText(e.target.value)
            }
            placeholder="OCRの生テキスト"
          />

          <div className="actions">
            <button
              onClick={() =>
                setParts((p) => [
                  ...parseOCR(ocrText),
                  ...p,
                ])
              }
            >
              OCR結果から追加
            </button>

            <button
              onClick={() =>
                setParts((p) => [
                  ...p,
                  {
                    id: uid(),
                    name: "",
                    qty: "1",
                    retail: "",
                    cost: "",
                  },
                ])
              }
            >
              ＋手入力
            </button>
          </div>

          <h2>抽出データ</h2>

          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>部品名称</th>
                  <th>個数</th>
                  <th>定価</th>
                  <th>仕入れ</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {parts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        value={p.name}
                        onChange={(e) =>
                          updatePart(
                            p.id,
                            "name",
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        inputMode="numeric"
                        value={p.qty}
                        onChange={(e) =>
                          updatePart(
                            p.id,
                            "qty",
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        inputMode="decimal"
                        value={p.retail}
                        onChange={(e) =>
                          updatePart(
                            p.id,
                            "retail",
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <input
                        inputMode="decimal"
                        value={p.cost}
                        onChange={(e) =>
                          updatePart(
                            p.id,
                            "cost",
                            e.target.value
                          )
                        }
                      />
                    </td>

                    <td>
                      <button
                        className="danger"
                        onClick={() =>
                          setParts((x) =>
                            x.filter(
                              (y) =>
                                y.id !== p.id
                            )
                          )
                        }
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="actions">
            <button onClick={copyTSV}>
              📋 Excelへコピー
            </button>

            <button onClick={csv}>
              CSV保存
            </button>

            <button
              className="primary"
              onClick={() =>
                setTab("print")
              }
            >
              印刷画面へ →
            </button>
          </div>
        </section>
      )}

      {tab === "data" && (
        <section className="card">
          <h1>保存データ</h1>

          <p>
            部品データはブラウザ内に保存されます。
            Excelへはタブ区切りでそのまま貼り付けできます。
          </p>

          <div className="stats">
            部品：<b>{parts.length}</b>件　
            車両：
            <b>{vehicles.length}</b>件
          </div>

          <div className="actions">
            <button onClick={copyTSV}>
              📋 Excelへコピー
            </button>

            <button onClick={csv}>
              CSV保存
            </button>

            <button
              onClick={() =>
                setParts([])
              }
            >
              部品データ全消去
            </button>
          </div>
        </section>
      )}

      {tab === "print" && (
        <section className="card">
          <div className="noPrint">
            <h1>指定用紙へ印刷</h1>

            <p>
              部品出庫伝票の空欄へ、
              部品名称・個数・定価・仕入れだけを重ね刷りします。
            </p>

            <label>
              印刷件数{" "}
              <input
                type="number"
                min="1"
                max={Math.max(
                  1,
                  parts.length
                )}
                value={printCount}
                onChange={(e) =>
                  setPrintCount(
                    Number(e.target.value)
                  )
                }
              />
            </label>

            <div className="actions">
              <button
                className="primary"
                onClick={() =>
                  window.print()
                }
              >
                🖨 印刷する
              </button>

              <button
                onClick={() =>
                  setTab("settings")
                }
              >
                印刷位置を調整
              </button>
            </div>
          </div>

          <div className="sheet">
            {parts
              .slice(0, printCount)
              .map((p, i) => (
                <div key={p.id}>
                  {(
                    [
                      "name",
                      "qty",
                      "retail",
                      "cost",
                    ] as const
                  ).map((f) => {
                    const b =
                      template.fields[f];

                    return (
                      <div
                        key={f}
                        className={
                          "overlay " +
                          (f === "name"
                            ? "name"
                            : "")
                        }
                        style={{
                          left: `${b.x}mm`,
                          top: `${
                            b.y + i * 7
                          }mm`,
                          width: `${b.w}mm`,
                          height: `${b.h}mm`,
                        }}
                      >
                        {f === "name"
                          ? p.name
                          : f === "qty"
                          ? p.qty
                          : f ===
                            "retail"
                          ? p.retail
                          : p.cost}
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        </section>
      )}

      {tab === "settings" && (
        <section className="card">
          <h1>印刷位置設定</h1>

          <p>
            実物の用紙写真をガイドとして読み込み、
            4項目のX/Y/W/Hをmmで調整します。
          </p>

          <label className="file">
            📷 用紙写真を読み込む
            <input
              type="file"
              accept="image/*"
              onChange={(e) =>
                e.target.files?.[0] &&
                importGuide(
                  e.target.files[0]
                )
              }
            />
          </label>

          <div className="positions">
            {(
              [
                "name",
                "qty",
                "retail",
                "cost",
              ] as const
            ).map((f) => (
              <div
                className="pos"
                key={f}
              >
                <h3>
                  {f === "name"
                    ? "部品名称"
                    : f === "qty"
                    ? "個数"
                    : f ===
                      "retail"
                    ? "定価"
                    : "仕入れ"}
                </h3>

                {(
                  [
                    "x",
                    "y",
                    "w",
                    "h",
                  ] as const
                ).map((k) => (
                  <label key={k}>
                    {k.toUpperCase()}

                    <input
                      type="number"
                      step=".5"
                      value={
                        template.fields[f][
                          k
                        ]
                      }
                      onChange={(e) =>
                        setBox(
                          f,
                          k,
                          e.target.value
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            ))}
          </div>

          <label>
            位置確認する部品

            <select
              value={selected}
              onChange={(e) =>
                setSelected(
                  e.target.value
                )
              }
            >
              <option value="">
                選択
              </option>

              {parts.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                >
                  {p.name ||
                    "名称未入力"}
                </option>
              ))}
            </select>
          </label>

          <div className="sheet preview">
            {guide ? (
              <img
                src={guide}
                alt="用紙ガイド"
              />
            ) : (
              <div className="placeholder">
                A4用紙ガイド
                <br />
                用紙写真を読み込んでください
              </div>
            )}

            {active && (
              <div
                className="overlay active"
                style={{
                  left: `${template.fields.name.x}mm`,
                  top: `${template.fields.name.y}mm`,
                  width: `${template.fields.name.w}mm`,
                }}
              >
                {active.name}
              </div>
            )}
          </div>

          <button
            onClick={() =>
              setTemplate(
                initialTemplate
              )
            }
          >
            初期位置に戻す
          </button>
        </section>
      )}

      <footer>
        icb / 部品伝票OCR・印刷
      </footer>
    </main>
  );
}
