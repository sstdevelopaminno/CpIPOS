import {test} from "node:test";
import assert from "node:assert/strict";
import {validateLogin,validateProtectedPreview} from "../dr/cloudflare-local-smoke.mjs";

test("login page must really be CpIPOS store login, not merely HTTP 200",()=>{
  assert.equal(validateLogin({status:200,body:"<title>CpIPOS</title><input id='storeCode'>"}),null);
  assert.equal(validateLogin({status:200,body:"<title>hello world</title>"}),"wrong_login_content");
  assert.equal(validateLogin({status:200,body:"CpIPOS page without form"}),"missing_store_login_form");
  assert.equal(validateLogin({status:402,body:"paused"}),"login_http_402");
});
test("protected preview must redirect to login, not render authenticated POS",()=>{
 assert.equal(validateProtectedPreview({status:307,location:"/login/store"}),null);
 assert.equal(validateProtectedPreview({status:307,location:"http://127.0.0.1:8787/login/store"}),null);
 assert.equal(validateProtectedPreview({status:200,location:null}),"preview_access_without_login_200");
 assert.equal(validateProtectedPreview({status:307,location:"/preview/pos"}),"wrong_preview_redirect");
});
