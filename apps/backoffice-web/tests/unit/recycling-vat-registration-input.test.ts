import {describe,expect,it} from "vitest";
import {parseVatRegistration} from "../../src/lib/recycling-vat-registration-input";
const valid={tax_id:"1234567890123",legal_name:"Synthetic shop",legal_address:"Synthetic address",branch_no:"00000",evidence_reference:"TEST-12345",verified_from:"2026-01-01",verified_until:"",confirmed:true};
describe("VAT registration attestation",()=>{
  it("requires complete actual-document attestation",()=>{
    expect(parseVatRegistration(valid,"2026-11-25")).toMatchObject({tax_id:valid.tax_id,verified_until:null});
    for(const change of [{confirmed:false},{tax_id:"123"},{branch_no:"0"},{evidence_reference:""},{verified_from:"2026-02-30"},{verified_from:"2027-01-01"},{verified_until:"2026-01-01"}])expect(parseVatRegistration({...valid,...change},"2026-11-25")).toBeNull();
  });
});
