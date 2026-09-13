import assert from "node:assert/strict";
import fs from "node:fs";

const search = fs.readFileSync(new URL("../app/schedule/search/page.tsx", import.meta.url), "utf8");
const edit = fs.readFileSync(new URL("../app/schedule/edit/page.tsx", import.meta.url), "utf8");

assert.match(search, /<div className="resultActions">/, "search result has a dedicated action group");
assert.match(search, />予約変更<\/button>/, "search result exposes edit action");
assert.match(search, />予約取消<\/button>/, "search result exposes cancel action");
assert.match(search, /\/schedule\/edit\?id="\+set\.primary\.entry\.id\+"\&mode=cancel"/, "cancel action opens direct cancellation mode");
assert.match(search, /\.resultActions\{display:grid;grid-template-columns:1fr 1fr;/, "edit/cancel actions are side-by-side");
assert.match(search, /\.cancelBtn\{color:#b42318;border-color:/, "cancel action is visually distinct in red");
assert.match(search, /@media\(max-width:720px\)[\s\S]*\.resultActions\{width:100%;min-width:0\}[\s\S]*\.editBtn,\.cancelBtn\{min-height:44px;/s, "mobile actions remain easy to tap");

assert.match(edit, /const \[cancelMode,setCancelMode\]=useState\(false\)/, "edit page tracks direct cancellation mode");
assert.match(edit, /params\.get\("mode"\)==="cancel"/, "edit page reads direct cancellation mode");
assert.match(edit, /setShowCancel\(directCancel\)/, "direct cancellation opens the existing confirmation immediately");
assert.match(edit, /entry && !cancelMode && <>/, "normal edit mode excludes cancellation confirmation");
assert.match(edit, /entry && cancelMode && showCancel/, "cancel mode renders the cancellation confirmation");
assert.doesNotMatch(edit, /onClick=\{\(\)=>setShowCancel\(true\)\}/, "normal edit page no longer duplicates the cancel entry point");
assert.match(edit, /onClick=\{\(\)=>history\.back\(\)\}>戻る<\/button>/, "cancel confirmation back action returns to the prior search flow");
assert.match(edit, /supabase\.rpc\("cancel_schedule_entry_v1"/, "direct cancel mode still uses the existing safe cancellation RPC");

console.log("schedule search actions regression: ok");
