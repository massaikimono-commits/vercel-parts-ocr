import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/schedule/new/page.tsx", import.meta.url), "utf8");

assert.match(source, /初入庫は「お客様名＋ナンバー下4桁」だけでも予定登録できます。/, "initial intake guidance allows name + last4 only");
assert.match(source, /if \(selectedVehicleIds\.length <= 1 && !registrationNumber\.trim\(\) && !registrationLast4\.trim\(\)\)/, "registration accepts either full registration or last4");
assert.match(source, /<section className="card actionCard">/, "feedback is grouped with the submit action");
assert.match(source, /className="warnings actionFeedback"/, "warning is beside submit");
assert.match(source, /className="errors actionFeedback"/, "errors are beside submit");
assert.match(source, /className="actionMessage" aria-live="polite">\{message\}/, "non-success status message remains beside submit");
assert.match(source, /"それでも登録する"/, "same-day override is available at the action area");

const topDynamicMessage = /<div className="notice">\{message\}<\/div>/;
assert.doesNotMatch(source, topDynamicMessage, "generic dynamic message is not shown at page top");
assert.match(source, /className="successBanner" role="status" aria-live="polite"/, "registration success is shown at page top");
assert.match(source, /setSuccessMessage\("予定を登録しました。"\)/, "single registration success uses top success message");
assert.match(source, /setSuccessMessage\(\`\$\{selectedRows\.length\}台の予定を登録しました。\`\)/, "batch registration success uses top success message");
assert.match(source, /window\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/, "successful registration scrolls to page top");

assert.match(source, /<strong style=\{\{fontSize:20\}\}>\{naturalLast4/, "registered vehicle list emphasizes natural last4");
assert.match(source, /詳細情報は入庫後に追記できます/, "missing vehicle details are allowed for initial intake");

console.log("schedule registration action feedback regression: ok");
