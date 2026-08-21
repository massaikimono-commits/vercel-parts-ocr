/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {supabase} from "./supabase";

type Part={
  id:string;
  name:string;
  qty:string;
  retail:string;
  cost:string;
  source?:string
};

type Vehicle={
  number:string;
  model:string;
  type:"EV"|"ガソリン"|"HV"|"その他";
  weight:string;
  registration:string;
  last4:string;
  chassis:string;
  firstRegistration:string;
  customerId:string
};

type Customer={
  id:string;
  type:"individual"|"company";
  name:string;
  companyName:string;
  phone:string;
  email:string;
  postalCode:string;
  address:string;
  notes:string
};

type Box={
  x:number;
  y:number;
  w:number;
  h:number
};

type Template={
  widthMm:number;
  heightMm:number;
  fields:{
    name:Box;
    qty:Box;
    retail:Box;
    cost:Box
  }
};

const initialTemplate:Template={
  widthMm:210,
  heightMm:297,
  fields:{
    name:{x:45,y:28,w:42,h:5},
    qty:{x:89,y:28,w:9,h:5},
    retail:{x:102,y:28,w:18,h:5},
    cost:{x:122,y:28,w:18,h:5}
  }
};

const uid=()=>
  Math.random().toString(36).slice(2)+Date.now().toString(36);

const money=(s:string)=>
  s.replace(/[^\d.-]/g,"");

function parseOCR(text:string):Part[]{
  const out:Part[]=[];

  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();

    if(!line) continue;

    const c=line
      .split(/[,\t，|]+/)
      .map(x=>x.trim())
      .filter(Boolean);

    if(c.length<4) continue;

    const n=c
      .slice(1)
      .filter(x=>/\d/.test(x));

    if(n.length>=3){
      out.push({
        id:uid(),
        name:c[0],
        qty:n[0].replace(/[^\d.-]/g,""),
        retail:money(n[1]),
        cost:money(n[2]),
        source:line
      });
    }
  }

  return out;
}

export default function Home(){

  const [session,setSession]=useState<any>(null);
  const [authLoading,setAuthLoading]=useState(true);

  const [loginId,setLoginId]=useState("");
  const [password,setPassword]=useState("");
  const [authMsg,setAuthMsg]=useState("");

  const [tab,setTab]=useState<
    "vehicle"|
    "customerVehicle"|
    "ocr"|
    "data"|
    "print"|
    "settings"
  >("vehicle");

  const emptyVehicle:Vehicle={
    number:"",
    model:"",
    type:"EV",
    weight:"",
    registration:"",
    last4:"",
    chassis:"",
    firstRegistration:"",
    customerId:""
  };

  const [vehicle,setVehicle]=useState<Vehicle>(emptyVehicle);
  const [vehicles,setVehicles]=useState<Vehicle[]>([]);

  const emptyCustomer:Customer={
    id:"",
    type:"individual",
    name:"",
    companyName:"",
    phone:"",
    email:"",
    postalCode:"",
    address:"",
    notes:""
  };

  const [customer,setCustomer]=useState<Customer>(emptyCustomer);
  const [customers,setCustomers]=useState<Customer[]>([]);

  const [customerSearch,setCustomerSearch]=useState("");
  const [registrationSearch,setRegistrationSearch]=useState("");
  const [vehicleSearch,setVehicleSearch]=useState("");

  const [parts,setParts]=useState<Part[]>([]);
  const [ocrText,setOcrText]=useState("");
  const [ocrBusy,setOcrBusy]=useState(false);
  const [progress,setProgress]=useState(0);

  const [msg,setMsg]=useState("");

  const [template,setTemplate]=useState<Template>(initialTemplate);
  const [guide,setGuide]=useState("");
  const [printCount,setPrintCount]=useState(10);
  const [selected,setSelected]=useState("");

  const fileRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{

    let mounted=true;

    supabase.auth.getSession().then(({data})=>{
      if(mounted){
        setSession(data.session);
        setAuthLoading(false);
      }
    });

    const {data:{subscription}}=
      supabase.auth.onAuthStateChange((_event,sess)=>{
        setSession(sess);
        setAuthLoading(false);
      });

    return ()=>{
      mounted=false;
      subscription.unsubscribe();
    };

  },[]);

  useEffect(()=>{

    try{

      const p=localStorage.getItem("parts-data");

      if(p){
        setParts(JSON.parse(p));
      }

      const t=localStorage.getItem("parts-template");

      if(t){
        setTemplate(JSON.parse(t));
      }

    }catch{}

  },[]);

  useEffect(()=>{
    localStorage.setItem(
      "parts-data",
      JSON.stringify(parts)
    );
  },[parts]);

  useEffect(()=>{
    localStorage.setItem(
      "parts-template",
      JSON.stringify(template)
    );
  },[template]);

  useEffect(()=>{

    if(!session) return;

    (async()=>{

      const [{data:cs},{data:vs}]=
        await Promise.all([

          supabase
            .from("customers")
            .select("*")
            .order("created_at",{ascending:false}),

          supabase
            .from("vehicles")
            .select("*")
            .order("created_at",{ascending:false})

        ]);

      if(cs){

        setCustomers(
          cs.map((c:any)=>({

            id:c.id,

            type:c.customer_type,

            name:c.name,

            companyName:
              c.company_name||"",

            phone:
              c.phone||"",

            email:
              c.email||"",

            postalCode:
              c.postal_code||"",

            address:
              c.address||"",

            notes:
              c.notes||""

          }))
        );

      }

      if(vs){

        setVehicles(
          vs.map((v:any)=>({

            number:
              v.vehicle_number,

            model:
              v.model||"",

            type:
              (v.fuel_type||"その他")
              as Vehicle["type"],

            weight:
              v.vehicle_weight==null
                ?""
                :String(v.vehicle_weight),

            registration:"",

            last4:
              v.registration_number_last4||"",

            chassis:
              v.chassis_number||"",

            firstRegistration:
              v.first_registration||"",

            customerId:
              v.customer_id||"",

            id:v.id

          } as any))
        );

      }

    })();

  },[session]);

  const filtered=useMemo(
    ()=>
      vehicles.filter(
        v=>
          !vehicleSearch ||
          v.number.includes(vehicleSearch) ||
          v.model.includes(vehicleSearch)
      ),
    [vehicles,vehicleSearch]
  );

  const customerFiltered=useMemo(
    ()=>
      customers.filter(
        c=>
          !customerSearch ||
          c.name.includes(customerSearch) ||
          c.companyName.includes(customerSearch) ||
          c.phone.includes(customerSearch)
      ),
    [customers,customerSearch]
  );

  const registrationFiltered=useMemo(
    ()=>
      vehicles.filter(
        v=>
          !registrationSearch ||
          v.last4===
            registrationSearch
              .trim()
              .slice(-4)
      ),
    [vehicles,registrationSearch]
  );

  async function login(){

    setAuthMsg("");

    const id=
      loginId
        .trim()
        .toLowerCase();

    if(!id){

      setAuthMsg(
        "ログインIDを入力してください。"
      );

      return;
    }

    if(!password){

      setAuthMsg(
        "パスワードを入力してください。"
      );

      return;
    }

    const internalEmail=
      `${id}@icb.local`;

    const {error}=
      await supabase.auth.signInWithPassword({

        email:internalEmail,

        password

      });

    if(error){

      setAuthMsg(
        "ログインIDまたはパスワードが違います。"
      );

    }

  }

  async function saveVehicle(){

    if(!vehicle.number.trim()){

      setMsg(
        "車体番号を入力してください。"
      );

      return;
    }
