import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("offers six account languages with Arabic RTL",async()=>{
  const source=await readFile(new URL("../app/i18n.tsx",import.meta.url),"utf8");
  for(const code of ["en","ru","ar","de","es","pt"])assert.match(source,new RegExp(`code:\\"${code}\\"`));
  assert.match(source,/language==="ar"\?"rtl":"ltr"/);
  assert.doesNotMatch(source,/MutationObserver|createTreeWalker/);
});
