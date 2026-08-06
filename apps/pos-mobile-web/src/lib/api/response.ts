import {NextResponse} from "next/server";
export function ok<T>(data:T){return NextResponse.json({data,error:null})}
export function fail(code:string,message="ไม่สามารถทำรายการได้",status=400){return NextResponse.json({data:null,error:{code,message}},{status})}
