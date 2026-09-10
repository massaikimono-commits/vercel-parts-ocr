from pathlib import Path

p = Path('app/schedule/active/page.tsx')
s = p.read_text()

def once(before, after, label):
    global s
    if before not in s:
        raise SystemExit(f'{label} anchor not found')
    s = s.replace(before, after, 1)

once(
'''  const [needsLoaner, setNeedsLoaner] = useState(false);\n  const [notes, setNotes] = useState("");\n''',
'''  const [needsLoaner, setNeedsLoaner] = useState(false);\n  const [isWaitingService, setIsWaitingService] = useState(false);\n  const [notes, setNotes] = useState("");\n''', 'waiting state')

once(
'''  useEffect(() => {\n    if (addDelivery) void loadDeliveryOptions();\n  }, [deliveryDay, addDelivery, reason]);\n''',
'''  useEffect(() => {\n    if (entryType !== "customer_visit" && isWaitingService) setIsWaitingService(false);\n    if (isWaitingService && addDelivery) setAddDelivery(false);\n  }, [entryType, isWaitingService, addDelivery]);\n\n  useEffect(() => {\n    if (addDelivery && !isWaitingService) void loadDeliveryOptions();\n  }, [deliveryDay, addDelivery, reason, isWaitingService]);\n''', 'waiting effects')

once(
'''  async function checkSlot(entry: string, startsAt: string, endsAt: string, printMode: string) {\n    const { data, error } = await supabase.rpc("schedule_slot_check_v2", {\n      p_entry_type: entry,\n      p_starts_at: startsAt,\n      p_ends_at: endsAt,\n      p_reason: reason,\n      p_exclude_entry_id: null,\n      p_print_time_mode: printMode,\n    });\n''',
'''  async function checkSlot(entry: string, startsAt: string, endsAt: string, printMode: string, waitingService = false) {\n    const { data, error } = await supabase.rpc("schedule_slot_check_v2", {\n      p_entry_type: entry,\n      p_starts_at: startsAt,\n      p_ends_at: endsAt,\n      p_reason: reason,\n      p_exclude_entry_id: null,\n      p_print_time_mode: printMode,\n      p_is_waiting_service: waitingService,\n    });\n''', 'waiting-aware slot check')

once(
'''    if (addDelivery && !selectedDelivery) {\n      setErrors(["納車時間を選択してください。"]);\n      return;\n    }\n\n    setBusy(true);\n    try {\n      const mainCheck = await checkSlot(entryType, main.startsAt, main.endsAt, main.printMode);\n      const deliveryCheck = addDelivery && selectedDelivery\n        ? await checkSlot("delivery", selectedDelivery.startsAt, selectedDelivery.endsAt, selectedDelivery.mode)\n''',
'''    const waitingService = entryType === "customer_visit" && isWaitingService;\n    if (!waitingService && addDelivery && !selectedDelivery) {\n      setErrors(["納車時間を選択してください。"]);\n      return;\n    }\n\n    setBusy(true);\n    try {\n      const mainCheck = await checkSlot(entryType, main.startsAt, main.endsAt, main.printMode, waitingService);\n      const deliveryCheck = !waitingService && addDelivery && selectedDelivery\n        ? await checkSlot("delivery", selectedDelivery.startsAt, selectedDelivery.endsAt, selectedDelivery.mode, false)\n''', 'submit checks')

once(
'''          needs_loaner: needsLoaner,\n          planned_delivery_at: addDelivery && selectedDelivery ? selectedDelivery.startsAt : null,\n''',
'''          needs_loaner: needsLoaner,\n          is_waiting_service: waitingService,\n          planned_delivery_at: !waitingService && addDelivery && selectedDelivery ? selectedDelivery.startsAt : null,\n''', 'work order waiting insert')

once(
'''      if (addDelivery && selectedDelivery) {\n        const { error: deliveryError } = await supabase.from("schedule_entries").insert({\n''',
'''      if (!waitingService && addDelivery && selectedDelivery) {\n        const { error: deliveryError } = await supabase.from("schedule_entries").insert({\n''', 'delivery suppression')

once(
'''          <div className="flags"><label><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> 急ぎ</label><label><input type="checkbox" checked={needsLoaner} onChange={(e) => setNeedsLoaner(e.target.checked)} /> 代車あり</label></div>\n''',
'''          <div className="flags"><label><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> 急ぎ</label><label><input type="checkbox" checked={needsLoaner} onChange={(e) => setNeedsLoaner(e.target.checked)} /> 代車あり</label>{entryType === "customer_visit" && <label><input type="checkbox" checked={isWaitingService} onChange={(e) => setIsWaitingService(e.target.checked)} /> 作業待ち</label>}</div>\n''', 'waiting UI')

once(
'''        <h2>② 納車予定</h2>\n        <label className="switch"><input type="checkbox" checked={addDelivery} onChange={(e) => setAddDelivery(e.target.checked)} /> 入庫と同時に納車予定も登録する</label>\n        {addDelivery && <div className="grid delivery"><label>納車日<input type="date" value={deliveryDay} onChange={(e) => setDeliveryDay(e.target.value)} /></label><label>納車時間<select value={deliveryKey} onChange={(e) => setDeliveryKey(e.target.value)}>{!deliveryOptions.length && <option value="">候補なし</option>}{deliveryOptions.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label></div>}\n''',
'''        <h2>② 納車予定</h2>\n        {isWaitingService ? <div className="notice">作業待ちのため納車予定は登録しません。</div> : <label className="switch"><input type="checkbox" checked={addDelivery} onChange={(e) => setAddDelivery(e.target.checked)} /> 入庫と同時に納車予定も登録する</label>}\n        {!isWaitingService && addDelivery && <div className="grid delivery"><label>納車日<input type="date" value={deliveryDay} onChange={(e) => setDeliveryDay(e.target.value)} /></label><label>納車時間<select value={deliveryKey} onChange={(e) => setDeliveryKey(e.target.value)}>{!deliveryOptions.length && <option value="">候補なし</option>}{deliveryOptions.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label></div>}\n''', 'waiting delivery UI')

p.write_text(s)

reg = Path('scripts/schedule-active-waiting-v13-regression.mjs')
reg.write_text('''import fs from "node:fs";\nimport assert from "node:assert/strict";\n\nconst page = fs.readFileSync("app/schedule/active/page.tsx", "utf8");\n\nassert.ok(page.includes('const [isWaitingService, setIsWaitingService] = useState(false);'), "active schedule tracks waiting state");\nassert.ok(page.includes('entryType === "customer_visit" && <label>'), "waiting control is customer-visit eligible without reason gating");\nassert.ok(page.includes('entryType !== "customer_visit" && isWaitingService'), "switching away from customer visit clears waiting");\nassert.ok(page.includes('if (isWaitingService && addDelivery) setAddDelivery(false);'), "waiting disables delivery selection");\nassert.ok(page.includes('p_is_waiting_service: waitingService'), "main slot check passes waiting flag");\nassert.ok(page.includes('is_waiting_service: waitingService'), "work order persists waiting flag");\nassert.ok(page.includes('planned_delivery_at: !waitingService && addDelivery'), "waiting keeps planned delivery null");\nassert.ok(page.includes('if (!waitingService && addDelivery && selectedDelivery)'), "waiting creates no delivery schedule entry");\nassert.ok(page.includes('if (!waitingService && addDelivery && !selectedDelivery)'), "waiting does not require a delivery time");\nassert.ok(page.includes('作業待ちのため納車予定は登録しません。'), "waiting UI explains delivery suppression");\nassert.ok(!page.includes('reason === "点検" && <label><input type="checkbox" checked={isWaitingService}'), "waiting eligibility is not inspection-only");\nconsole.log("schedule active waiting v1.3 regression: PASS");\n''')
