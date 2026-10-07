
(() => {
  "use strict";

  const rawCfg = window.GROWLOG_CONFIG || {};

  function cleanConfigValue(value, envName){
    let v=String(value || "").trim();
    if(!v) return "";
    if(v.startsWith(envName+"=")) v=v.slice(envName.length+1).trim();
    if((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))){
      v=v.slice(1,-1).trim();
    }
    return v;
  }

  const cfg = {
    SUPABASE_URL: cleanConfigValue(rawCfg.SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_ANON_KEY: cleanConfigValue(rawCfg.SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    SITE_URL: cleanConfigValue(rawCfg.SITE_URL, "SITE_URL")
  };

  const configured =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR_PROJECT") &&
    !cfg.SUPABASE_ANON_KEY.includes("YOUR_");

  let db = null;
  let session = null;
  let profile = null;
  let activeClass = null;
  let activeChild = null;
  let activeEnrollment = null;
  let activeTeacherProfile = null;
  let pendingSignupPhone = "";
  let signupVerified = false;
  let adminEditingClassId = null;
  let prodPhotos = [];
  let realtimeChannel = null;

  const $ = (id) => document.getElementById(id);
  const q = (sel, root=document) => root.querySelector(sel);
  const qa = (sel, root=document) => [...root.querySelectorAll(sel)];
  const todayISO = () => {
    const d = new Date();
    const z = n => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
  };
  const escape = (v) => String(v ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
  const money = (n) => Number(n || 0).toLocaleString("ko-KR")+"원";
  const shortName = (name) => {
    const s = String(name || "");
    return s.length >= 3 ? s.slice(1) : s;
  };
  const weekdayChar = (date=new Date()) => ["일","월","화","수","목","금","토"][date.getDay()];
  const normalizePhone = (raw) => {
    let d = String(raw || "").replace(/\D/g,"");
    if (d.startsWith("82")) return "+"+d;
    if (d.startsWith("0")) d = d.slice(1);
    return "+82"+d;
  };
  const joinCodeFromUrl = () => new URLSearchParams(location.search).get("join") || "";

  function notify(msg){ if (typeof window.toast === "function") window.toast(msg); else alert(msg); }

  function setupError(message){
    document.body.classList.remove("prod-auth-pending");
    const main = q("main.wrap");
    if (!main) return;
    const div = document.createElement("div");
    div.className = "prod-setup-error";
    div.innerHTML = "<b>Growlog 설정이 필요합니다.</b><br>"+escape(message);
    main.prepend(div);
  }

  function setRoleClass(role){
    document.body.classList.remove("prod-auth-pending","prod-role-parent","prod-role-teacher","prod-role-admin");
    if (role) document.body.classList.add("prod-role-"+role);
  }

  function hideAllRolePages(){
    ["parent","teacher","admin"].forEach(id => $(id)?.classList.add("hide"));
  }

  function showAuth(){
    hideAllRolePages();
    $("parentAuth")?.classList.remove("hide");
    q(".roles")?.classList.add("hide");
    q(".mobile-nav")?.classList.add("hide");
    $("prodLogoutBtn")?.classList.add("hide");
    setRoleClass(null);
  }

  async function getProfile(userId){
    const { data, error } = await db.from("profiles")
      .select("id, role, name, phone, active")
      .eq("id", userId).single();
    if (error) throw error;
    return data;
  }

  async function routeAuthenticated(){
    if (!session?.user) return showAuth();
    profile = await getProfile(session.user.id);
    if (!profile.active){
      await db.auth.signOut();
      throw new Error("비활성화된 계정입니다. 관리자에게 문의해주세요.");
    }

    $("parentAuth")?.classList.add("hide");
    $("prodLogoutBtn")?.classList.remove("hide");

    if (profile.role === "admin"){
      setRoleClass("admin");
      q(".roles")?.classList.remove("hide");
      q(".mobile-nav")?.classList.remove("hide");
      await switchRoleProd("admin");
    } else if (profile.role === "teacher"){
      setRoleClass("teacher");
      q(".roles")?.classList.add("hide");
      q(".mobile-nav")?.classList.add("hide");
      await switchRoleProd("teacher");
    } else {
      setRoleClass("parent");
      q(".roles")?.classList.add("hide");
      q(".mobile-nav")?.classList.add("hide");
      await switchRoleProd("parent");
    }
    subscribeRealtime();
  }

  async function switchRoleProd(role){
    if (!profile) return;
    if (profile.role !== "admin" && role !== profile.role) return;

    hideAllRolePages();
    $(role)?.classList.remove("hide");

    qa(".roles button,.mobile-nav button").forEach(btn=>{
      btn.classList.toggle("on",btn.dataset.role===role);
    });

    if (role==="parent") await loadParentDashboard(profile.role==="admin");
    if (role==="teacher") await loadTeacherDashboard(profile.role==="admin");
    if (role==="admin") await loadAdminDashboard();

    window.scrollTo({top:0,behavior:"smooth"});
  }
  window.switchRole = switchRoleProd;

  // ---------- Auth ----------
  window.demoParentLogin = async function(){
    if (!db){
      notify("Supabase 연결이 아직 되지 않았어요. 화면 위쪽의 설정 오류 문구를 확인해주세요.");
      return;
    }
    try{
      const loginId = ($("parentPhone")?.value || "").trim();
      const password = $("parentPassword")?.value || "";
      if (!loginId || !password) return notify("이메일 또는 휴대폰번호와 비밀번호를 입력해주세요.");

      const credentials = loginId.includes("@")
        ? { email: loginId, password }
        : { phone: normalizePhone(loginId), password };

      const { data, error } = await db.auth.signInWithPassword(credentials);
      if (error) throw error;
      session = data.session;
      await routeAuthenticated();
      notify("로그인했습니다.");
    }catch(e){ notify("로그인 실패: "+e.message); }
  };

  window.sendDemoCode = async function(){
    if (!db) return;
    try{
      const phone = normalizePhone($("signupPhone")?.value);
      if (!phone || phone.length < 10) return notify("휴대폰번호를 확인해주세요.");
      const { error } = await db.auth.signInWithOtp({
        phone,
        options:{ shouldCreateUser:true }
      });
      if (error) throw error;
      pendingSignupPhone = phone;
      $("codeArea")?.classList.remove("hide");
      notify("인증번호를 발송했습니다.");
    }catch(e){ notify("인증번호 발송 실패: "+e.message); }
  };

  window.verifyDemoCode = async function(){
    if (!db) return;
    try{
      const token = ($("verifyCode")?.value || "").trim();
      if (!pendingSignupPhone || token.length < 6) return notify("인증번호 6자리를 입력해주세요.");
      const { data, error } = await db.auth.verifyOtp({
        phone:pendingSignupPhone,
        token,
        type:"sms"
      });
      if (error) throw error;
      session = data.session;
      signupVerified = true;
      notify("휴대폰 인증이 완료되었습니다.");
    }catch(e){ notify("인증 실패: "+e.message); }
  };

  window.completeDemoSignup = async function(){
    if (!db) return;
    try{
      const guardian = ($("guardianName")?.value || "").trim();
      const password = $("newPassword")?.value || "";
      const child = ($("childName")?.value || "").trim();
      const birth = $("childBirth")?.value || "";
      const agree = $("agreeRequired")?.checked;
      const joinCode = joinCodeFromUrl();

      if (!signupVerified || !session) return notify("먼저 휴대폰 인증을 완료해주세요.");
      if (!guardian || password.length < 8 || !child || !birth) return notify("필수 정보를 모두 입력해주세요. 비밀번호는 8자 이상으로 설정해주세요.");
      if (!agree) return notify("필수 동의 항목을 확인해주세요.");
      if (!joinCode) return notify("센터의 수업 QR을 통해 접속해주세요.");

      const { error:updateError } = await db.auth.updateUser({
        password,
        data:{ guardian_name:guardian }
      });
      if (updateError) throw updateError;

      const { error:rpcError } = await db.rpc("register_parent_child",{
        p_guardian_name:guardian,
        p_child_name:child,
        p_birth_date:birth,
        p_join_code:joinCode
      });
      if (rpcError) throw rpcError;

      profile = await getProfile(session.user.id);
      $("signupMessage")?.classList.add("show");
      await routeAuthenticated();
      notify("회원가입이 완료되었습니다.");
    }catch(e){ notify("회원가입 실패: "+e.message); }
  };

  async function logout(){
    if (!db) return;
    await db.auth.signOut();
    session = null; profile = null; activeClass=null; activeChild=null; activeEnrollment=null;
    if (realtimeChannel){ await db.removeChannel(realtimeChannel); realtimeChannel=null; }
    showAuth();
  }

  // ---------- Parent ----------
  async function getParentChildren(){
    let query = db.from("children").select("id,name,birth_date,parent_id").order("created_at");
    if (profile.role!=="admin") query = query.eq("parent_id",profile.id);
    const {data,error}=await query;
    if(error) throw error;
    return data||[];
  }

  async function loadParentDashboard(adminPreview=false){
    let children = await getParentChildren();
    if (!children.length){
      activeChild=null;
      renderParentEmpty("연결된 아이가 없습니다.");
      return;
    }
    activeChild = children[0];

    if (adminPreview && children.length>1){
      ensureAdminPreviewSelector("parent",children.map(c=>({id:c.id,label:c.name})),async id=>{
        activeChild=children.find(c=>c.id===id);
        await renderParentForChild();
      });
    }
    await renderParentForChild();
  }

  function ensureAdminPreviewSelector(kind,items,onChange){
    const root = kind==="parent" ? $("parent") : $("teacherClassSelectView");
    if (!root) return;
    let box = q(`.prod-admin-preview[data-kind="${kind}"]`,root);
    if (!box){
      box=document.createElement("div");
      box.className="prod-admin-preview";
      box.dataset.kind=kind;
      root.prepend(box);
    }
    box.innerHTML=`관리자 미리보기 · <select>${items.map(x=>`<option value="${escape(x.id)}">${escape(x.label)}</option>`).join("")}</select>`;
    q("select",box).onchange=e=>onChange(e.target.value);
  }

  function renderParentEmpty(text){
    const heroTitle=$("parentHeroTitle");
    if(heroTitle) heroTitle.textContent=text;
    $("parentTodayContent")?.classList.add("hide");
    $("parentAbsentNotice")?.classList.add("hide");
    $("feeNotice")?.classList.add("hide");
  }

  async function renderParentForChild(){
    if(!activeChild) return;
    currentParentStudentName = activeChild.name;
    const display=shortName(activeChild.name);

    const {data:enrollments,error:e1}=await db.from("enrollments")
      .select("id,active,created_at,class_id,classes(id,term,program,weekday,class_time,status,class_amount,center_id,teacher_id,centers(name))")
      .eq("child_id",activeChild.id)
      .order("created_at",{ascending:false});
    if(e1) throw e1;

    activeEnrollment=(enrollments||[]).find(e=>e.active && e.classes?.status!=="종료") || enrollments?.[0] || null;
    activeClass=activeEnrollment?.classes || null;

    const title=$("parentHeroTitle");
    if(title) title.textContent=display+"의 오늘을 기록했어요. 😊";

    await renderParentToday();
    await renderParentFees();
    await renderParentCourses(enrollments||[]);
    wireParentInquiry();
  }

  async function renderParentToday(){
    if(!activeChild || !activeClass){
      $("parentTodayContent")?.classList.add("hide");
      $("parentAbsentNotice")?.classList.add("hide");
      return;
    }
    const date=todayISO();
    const {data:att}=await db.from("attendance")
      .select("status").eq("child_id",activeChild.id).eq("class_id",activeClass.id).eq("lesson_date",date).maybeSingle();

    if(att?.status==="absent"){
      $("parentTodayContent")?.classList.add("hide");
      $("parentAbsentNotice")?.classList.remove("hide");
      if($("parentHeroTitle")) $("parentHeroTitle").textContent=shortName(activeChild.name)+"는 오늘 수업에 참여하지 못했어요. 😢";
      if($("parentHeroText")) $("parentHeroText").textContent="다음시간에는 꼭 만나요";
      return;
    }

    $("parentAbsentNotice")?.classList.add("hide");
    $("parentTodayContent")?.classList.remove("hide");

    const {data:record}=await db.from("growth_records")
      .select("*").eq("child_id",activeChild.id).eq("class_id",activeClass.id).eq("lesson_date",date).maybeSingle();

    if(record){
      if($("parentGrowthArea")) $("parentGrowthArea").textContent=record.area || "";
      if($("parentBehaviorText")) $("parentBehaviorText").textContent=record.behavior || "";
      if($("parentBehaviorDesc")) $("parentBehaviorDesc").textContent=record.observation_text || "";
      if($("parentMissionText")) $("parentMissionText").textContent=record.mission || "";
      const ex=Array.isArray(record.expansion_questions)?record.expansion_questions:[];
      if($("parentExpansionList")) $("parentExpansionList").innerHTML=ex.map(x=>`<li>${escape(x)}</li>`).join("");
    }else{
      if($("parentBehaviorText")) $("parentBehaviorText").textContent="오늘의 성장기록을 기다리고 있어요.";
      if($("parentBehaviorDesc")) $("parentBehaviorDesc").textContent="강사님이 기록을 저장하면 이곳에 바로 보여요.";
      if($("parentMissionText")) $("parentMissionText").textContent="수업 기록이 등록되면 질문 미션도 함께 보여요.";
      if($("parentExpansionList")) $("parentExpansionList").innerHTML="";
    }
    await renderParentPhotos(date);
  }

  async function signedUrl(path,expires=3600){
    const {data,error}=await db.storage.from("activity-photos").createSignedUrl(path,expires);
    if(error) throw error;
    return data.signedUrl;
  }

  async function renderParentPhotos(date){
    const pool=$("parentActivityPhotos");
    if(!pool) return;
    pool.innerHTML="";
    const {data,error}=await db.from("photo_assignments")
      .select("photo_id,photos(id,storage_path,lesson_date,class_id)")
      .eq("child_id",activeChild.id);
    if(error) throw error;
    const rows=(data||[]).filter(x=>x.photos?.lesson_date===date && x.photos?.class_id===activeClass.id);
    if(!rows.length){
      pool.innerHTML='<div class="photo-empty">오늘 연결된 활동사진이 아직 없습니다.</div>';
      return;
    }
    for(const row of rows){
      const url=await signedUrl(row.photos.storage_path,3600);
      const div=document.createElement("div");
      div.className="photo prod-photo-card";
      div.innerHTML=`<img src="${url}" alt="활동사진"><button class="prod-download" type="button" aria-label="사진 저장">↓</button>`;
      q(".prod-download",div).onclick=()=>downloadUrl(url,`${activeChild.name}_${date}.jpg`);
      pool.appendChild(div);
    }
  }

  async function downloadUrl(url,filename){
    try{
      const res=await fetch(url);
      const blob=await res.blob();
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download=filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    }catch{
      window.open(url,"_blank","noopener");
    }
  }

  async function renderParentFees(){
    const notice=$("feeNotice");
    if(!notice||!activeChild) return;
    const {data,error}=await db.from("fees")
      .select("id,program,item,amount,visible,paid,class_id,classes(center_id,centers(name))")
      .eq("child_id",activeChild.id).eq("visible",true).eq("paid",false)
      .order("created_at",{ascending:false}).limit(1);
    if(error) throw error;
    const fee=data?.[0];
    if(!fee){ notice.classList.add("hide"); return; }
    notice.classList.remove("hide");
    if($("parentFeeProgram")) $("parentFeeProgram").textContent=fee.program||"";
    if($("parentFeeItem")) $("parentFeeItem").textContent=fee.item||"";
    if($("parentFeeAmount")) $("parentFeeAmount").textContent=money(fee.amount);
    if($("parentFeeDepositor")) $("parentFeeDepositor").textContent=(fee.classes?.centers?.name||"센터")+"_"+activeChild.name;
  }

  window.copyName=async function(){
    const value=$("parentFeeDepositor")?.textContent?.trim()||"";
    if(!value) return;
    try{ await navigator.clipboard.writeText(value); notify("입금자명을 복사했습니다."); }
    catch{ window.prompt("아래 입금자명을 복사해주세요.",value); }
  };

  async function renderParentCourses(enrollments){
    const old=$("courseSummer")?.closest(".card");
    if(!old) return;
    old.innerHTML='<h2>📚 수강 기록</h2><div id="prodCourseList"></div>';
    const list=$("prodCourseList");

    for(const enr of enrollments){
      const c=enr.classes;
      if(!c) continue;
      const block=document.createElement("div");
      block.className="prod-course-block";
      const status=enr.active && c.status!=="종료" ? "수강중" : "지난 수강";
      block.innerHTML=`
        <div class="record course-record" role="button" tabindex="0">
          <div class="row between">
            <div><b>${escape(c.term)} · ${escape(c.program)}</b>
            <div class="muted">${escape(c.weekday)}요일 ${escape(String(c.class_time).slice(0,5))} · ${escape(c.centers?.name||"")}</div></div>
            <div class="row"><span class="badge ${status==="수강중"?"":"gray"}">${status}</span><span>⌄</span></div>
          </div>
        </div>
        <div class="prod-course-history"></div>`;
      q(".course-record",block).onclick=()=>toggleEnrollmentHistory(enr,q(".prod-course-history",block));
      list.appendChild(block);
    }
    if(!enrollments.length) list.innerHTML='<div class="prod-empty">수강 기록이 없습니다.</div>';
  }

  async function toggleEnrollmentHistory(enrollment,box){
    box.classList.toggle("open");
    if(!box.classList.contains("open") || box.dataset.loaded==="1") return;
    box.innerHTML='<div class="prod-loading-card">기록을 불러오는 중...</div>';
    const {data:records,error}=await db.from("growth_records")
      .select("*").eq("child_id",activeChild.id).eq("class_id",enrollment.class_id)
      .order("lesson_date",{ascending:false});
    if(error){ box.innerHTML='<div class="prod-empty">기록을 불러오지 못했습니다.</div>'; return; }

    const {data:assignments}=await db.from("photo_assignments")
      .select("photo_id,photos(id,storage_path,lesson_date,class_id)")
      .eq("child_id",activeChild.id);

    box.innerHTML="";
    for(const rec of records||[]){
      const row=document.createElement("div");
      row.className="prod-history-row";
      row.innerHTML=`<b>${escape(rec.lesson_date)} · ${escape(rec.area||"")}</b>
        <div style="margin-top:4px">${escape(rec.behavior||"")}</div>
        <div class="muted" style="margin-top:4px">${escape(rec.observation_text||"")}</div>`;
      const photos=(assignments||[]).filter(a=>a.photos?.class_id===enrollment.class_id && a.photos?.lesson_date===rec.lesson_date);
      if(photos.length){
        const pbox=document.createElement("div"); pbox.className="prod-history-photos";
        for(const p of photos){
          const url=await signedUrl(p.photos.storage_path,3600);
          const wrap=document.createElement("div"); wrap.className="prod-photo-card";
          wrap.innerHTML=`<img src="${url}" alt="지난 활동사진"><button class="prod-download" type="button">↓</button>`;
          q("button",wrap).onclick=()=>downloadUrl(url,`${activeChild.name}_${rec.lesson_date}.jpg`);
          pbox.appendChild(wrap);
        }
        row.appendChild(pbox);
      }
      box.appendChild(row);
    }
    if(!(records||[]).length) box.innerHTML='<div class="prod-empty">저장된 성장기록이 없습니다.</div>';
    box.dataset.loaded="1";
  }

  function wireParentInquiry(){
    window.submitParentInquiry=async function(){
      try{
        if(!activeChild||!activeClass) return notify("연결된 수업이 없습니다.");
        const type=$("parentInquiryType")?.value||"궁금한 점";
        const target=$("parentInquiryTarget")?.value||"teacher";
        const content=($("parentInquiryContent")?.value||"").trim();
        if(!content) return notify("전달할 내용을 입력해주세요.");

        const payload={
          parent_id:activeChild.parent_id,
          child_id:activeChild.id,
          class_id:activeClass.id,
          target,
          type,
          content,
          status:"unread",
          assigned_teacher_id:target==="teacher"?activeClass.teacher_id:null
        };
        const {error}=await db.from("inquiries").insert(payload);
        if(error) throw error;
        $("parentInquiryContent").value="";
        notify(target==="teacher"?"담당 강사에게 전달했습니다.":"회사에 전달했습니다.");
      }catch(e){ notify("전송 실패: "+e.message); }
    };
  }

  // ---------- Teacher ----------
  async function loadTeacherDashboard(adminPreview=false){
    if(adminPreview){
      const {data:teachers,error}=await db.from("profiles").select("id,name").eq("role","teacher").eq("active",true).order("name");
      if(error) throw error;
      if(!teachers?.length){ renderTeacherClassCards([]); return; }
      activeTeacherProfile=teachers[0];
      ensureAdminPreviewSelector("teacher",teachers.map(t=>({id:t.id,label:t.name+" 강사"})),async id=>{
        activeTeacherProfile=teachers.find(t=>t.id===id);
        await loadTeacherClasses();
      });
    }else{
      activeTeacherProfile=profile;
    }
    await loadTeacherClasses();
    await loadTeacherInquiries();
    bindBulkUpload();
  }

  async function loadTeacherClasses(){
    if(!activeTeacherProfile) return;
    const {data,error}=await db.from("classes")
      .select("id,term,program,weekday,class_time,status,student_capacity,center_id,centers(name)")
      .eq("teacher_id",activeTeacherProfile.id)
      .neq("status","종료")
      .order("weekday").order("class_time");
    if(error) throw error;
    renderTeacherClassCards(data||[]);
  }

  function renderTeacherClassCards(classes){
    const todayList=$("teacherTodayClassList");
    const otherList=$("teacherOtherClassList");
    if(!todayList||!otherList) return;
    todayList.innerHTML=""; otherList.innerHTML="";
    const wd=weekdayChar();

    const addCard=async(c,target,today)=>{
      const {count}=await db.from("enrollments").select("*",{count:"exact",head:true}).eq("class_id",c.id).eq("active",true);
      const total=count||0;
      const date=todayISO();
      const {data:g}=await db.from("growth_records").select("child_id").eq("class_id",c.id).eq("lesson_date",date);
      const {data:a}=await db.from("attendance").select("child_id,status").eq("class_id",c.id).eq("lesson_date",date).eq("status","absent");
      const processed=new Set([...(g||[]).map(x=>x.child_id),...(a||[]).map(x=>x.child_id)]).size;
      const card=document.createElement("div");
      card.className="teacher-class-card"+(today?" today":"");
      card.innerHTML=`
        <div><b style="font-size:18px">${escape(c.centers?.name||"")} · ${escape(c.program)}</b>
        <div class="teacher-class-meta">
          <span class="badge">${escape(c.term)}</span>
          <span class="badge gray">${escape(c.weekday)}요일 ${escape(String(c.class_time).slice(0,5))}</span>
          <span class="badge gray">학생 ${total}명</span>
        </div></div>
        <div class="teacher-class-progress">
          <div class="muted"><b style="color:var(--ink)">${processed} / ${total}명</b> 기록 완료</div>
          <button class="btn ${processed>=total&&total?'sec':''}" type="button">${processed>=total&&total?'기록 확인하기':processed?'이어서 기록하기':'수업 기록하기'}</button>
        </div>`;
      q("button",card).onclick=()=>openTeacherClassProd(c);
      target.appendChild(card);
    };

    const todays=classes.filter(c=>c.weekday===wd);
    const others=classes.filter(c=>c.weekday!==wd);
    if(!todays.length) todayList.innerHTML='<div class="teacher-class-empty">오늘 배정된 수업이 없습니다.</div>';
    if(!others.length) otherList.innerHTML='<div class="teacher-class-empty">추가로 배정된 수업이 없습니다.</div>';
    todays.forEach(c=>addCard(c,todayList,true));
    others.forEach(c=>addCard(c,otherList,false));
  }

  window.renderTeacherClassSelection = async function(){ await loadTeacherClasses(); };

  async function openTeacherClassProd(c){
    activeClass=c;
    $("teacherClassSelectView")?.classList.add("hide");
    $("teacherClassWorkView")?.classList.remove("hide");
    if($("activeTeacherClassLabel")) $("activeTeacherClassLabel").textContent=`${c.centers?.name||""} · ${c.program} · ${c.weekday}요일 ${String(c.class_time).slice(0,5)}`;
    await loadTeacherStudentsForClass();
    await loadTeacherPhotos();
    const photoTab=$("lessonTabPhotos");
    if(photoTab && typeof window.showLessonWork==="function") window.showLessonWork("photos",photoTab);
  }
  window.openTeacherClass = function(center,program,term,time,classId){
    const match=window.__prodTeacherClasses?.find?.(x=>x.id===classId);
    if(match) return openTeacherClassProd(match);
  };

  window.backToTeacherClassSelect=function(){
    activeClass=null;
    $("teacherClassWorkView")?.classList.add("hide");
    $("teacherClassSelectView")?.classList.remove("hide");
    loadTeacherClasses();
    window.scrollTo({top:0,behavior:"smooth"});
  };

  async function loadTeacherStudentsForClass(){
    if(!activeClass) return;
    const {data,error}=await db.from("enrollments")
      .select("child_id,children(id,name,birth_date)")
      .eq("class_id",activeClass.id).eq("active",true);
    if(error) throw error;
    const children=(data||[]).map(x=>x.children).filter(Boolean);
    teacherStudents.splice(0,teacherStudents.length,...children.map(c=>c.name));
    Object.keys(studentRecordState).forEach(k=>delete studentRecordState[k]);

    const date=todayISO();
    const {data:records}=await db.from("growth_records").select("*").eq("class_id",activeClass.id).eq("lesson_date",date);
    const {data:attendance}=await db.from("attendance").select("*").eq("class_id",activeClass.id).eq("lesson_date",date);

    for(const c of children){
      const rec=(records||[]).find(r=>r.child_id===c.id);
      const att=(attendance||[]).find(a=>a.child_id===c.id);
      studentRecordState[c.name]={
        childId:c.id,
        growthArea:rec?.area||"도전",
        behavior:rec?.behavior||"어려워도 다시 시도했어요",
        mission:0,
        missionText:rec?.mission||"",
        photos:new Set(),
        complete:Boolean(rec||att?.status==="absent"),
        dirty:false,
        absent:att?.status==="absent",
        completeBeforeAbsent:null,
        courseHistoryRecordId:null
      };
    }

    const tabs=$("lessonStudentTabs");
    if(tabs){
      tabs.innerHTML='<button id="lessonTabPhotos" class="on" type="button">전체 사진</button>';
      q("#lessonTabPhotos",tabs).onclick=function(){ window.showLessonWork("photos",this); };
      children.forEach(c=>{
        const b=document.createElement("button");
        b.type="button"; b.dataset.student=c.name; b.textContent=c.name;
        if(studentRecordState[c.name].complete) b.classList.add("done");
        b.onclick=function(){ window.showLessonWork("student",this,c.name); };
        tabs.appendChild(b);
      });
    }
    currentTeacherStudent=children[0]?.name||"";
    if(currentTeacherStudent) window.loadStudentRecord?.(currentTeacherStudent);
    window.updateLessonProgress?.();
  }

  async function loadTeacherPhotos(){
    prodPhotos=[];
    uploadedActivityPhotos.splice(0,uploadedActivityPhotos.length);
    if(!activeClass) return;
    const {data,error}=await db.from("photos").select("*").eq("class_id",activeClass.id).eq("lesson_date",todayISO()).order("created_at");
    if(error) throw error;

    for(const p of data||[]){
      const url=await signedUrl(p.storage_path,3600);
      prodPhotos.push({...p,url});
      uploadedActivityPhotos.push({...p,url});
    }
    const {data:assign}=await db.from("photo_assignments").select("photo_id,child_id").in("photo_id",(data||[]).map(p=>p.id).length?(data||[]).map(p=>p.id):["00000000-0000-0000-0000-000000000000"]);
    for(const name of teacherStudents){
      const st=studentRecordState[name]; if(!st) continue;
      st.photos=new Set();
      prodPhotos.forEach((p,i)=>{ if((assign||[]).some(a=>a.photo_id===p.id&&a.child_id===st.childId)) st.photos.add(i); });
    }
    renderTeacherUploadPreviewProd();
    renderChildPhotoPickerProd();
  }

  function renderTeacherUploadPreviewProd(){
    const pool=$("uploadPreview"); if(!pool) return;
    pool.innerHTML="";
    if(!prodPhotos.length){pool.innerHTML='<div class="photo-empty">아직 업로드된 사진이 없습니다.</div>';return;}
    prodPhotos.forEach((p,i)=>{
      const div=document.createElement("div"); div.className="photo";
      div.innerHTML=`<img src="${p.url}" alt="업로드 사진 ${i+1}">`;
      pool.appendChild(div);
    });
  }

  async function renderChildPhotoPickerProd(){
    const pool=$("childPhotoPicker"); if(!pool) return;
    pool.innerHTML="";
    const st=studentRecordState[currentTeacherStudent];
    if(!st||!prodPhotos.length){pool.innerHTML='<div class="photo-empty">선택할 사진이 없습니다.</div>';return;}
    prodPhotos.forEach((p,i)=>{
      const div=document.createElement("div");
      div.className="photo"+(st.photos.has(i)?" sel":"");
      div.innerHTML=`<img src="${p.url}" alt="${escape(currentTeacherStudent)} 사진">`;
      div.onclick=async()=>{
        try{
          if(st.photos.has(i)){
            const {error}=await db.from("photo_assignments").delete().eq("photo_id",p.id).eq("child_id",st.childId);
            if(error) throw error; st.photos.delete(i);
          }else{
            const {error}=await db.from("photo_assignments").upsert({photo_id:p.id,child_id:st.childId},{onConflict:"photo_id,child_id"});
            if(error) throw error; st.photos.add(i);
          }
          div.classList.toggle("sel",st.photos.has(i));
        }catch(e){notify("사진 연결 실패: "+e.message);}
      };
      pool.appendChild(div);
    });
  }

  window.renderTeacherUploadPreview=renderTeacherUploadPreviewProd;
  window.renderChildPhotoPicker=renderChildPhotoPickerProd;

  function bindBulkUpload(){
    const old=$("bulk"); if(!old||old.dataset.prodBound==="1") return;
    const fresh=old.cloneNode(true); old.replaceWith(fresh); fresh.dataset.prodBound="1";
    fresh.onchange=async e=>{
      const files=[...e.target.files].slice(0,12);
      if(!files.length||!activeClass) return;
      try{
        for(const file of files){
          const safe=file.name.replace(/[^0-9A-Za-z가-힣._-]/g,"_");
          const path=`${activeClass.id}/${todayISO()}/${crypto.randomUUID()}-${safe}`;
          const {error:upErr}=await db.storage.from("activity-photos").upload(path,file,{upsert:false});
          if(upErr) throw upErr;
          const {error:dbErr}=await db.from("photos").insert({
            class_id:activeClass.id,lesson_date:todayISO(),storage_path:path,uploaded_by:session.user.id
          });
          if(dbErr) throw dbErr;
        }
        await loadTeacherPhotos();
        notify(files.length+"장의 사진을 업로드했습니다.");
      }catch(err){notify("사진 업로드 실패: "+err.message);}
    };
  }

  window.loadStudentRecord = function(name){
    currentTeacherStudent=name;
    const st=studentRecordState[name]; if(!st) return;
    loadingStudentRecord=true;
    if($("activeStudentName")) $("activeStudentName").textContent=name+" 성장 기록";
    selectedGrowthArea=st.growthArea;
    if($("growthAreaSelect")) $("growthAreaSelect").value=st.growthArea;
    const behavior=$("behavior");
    if(behavior){
      behavior.innerHTML="";
      (growthAreas[selectedGrowthArea]||[]).forEach(t=>behavior.add(new Option(t,t)));
      behavior.value=(growthAreas[selectedGrowthArea]||[]).includes(st.behavior)?st.behavior:behavior.value;
    }
    const mission=$("mission");
    if(mission){
      mission.innerHTML="";
      (missionData[behavior.value]||[]).forEach((x,i)=>mission.add(new Option(x.q,i)));
      const idx=(missionData[behavior.value]||[]).findIndex(x=>x.q===st.missionText);
      mission.value=String(idx>=0?idx:0);
    }
    loadingStudentRecord=false;
    window.previewExpansion?.();
    renderChildPhotoPickerProd();
    window.updateStudentEditUI?.(name);
  };

  window.saveCurrentStudentRecord=async function(){
    const st=studentRecordState[currentTeacherStudent];
    if(!st||!activeClass) return;
    if(st.absent) return notify("결석 처리된 아이는 성장기록을 저장하지 않습니다.");
    try{
      const behavior=$("behavior")?.value||st.behavior;
      const mi=Number($("mission")?.value||0);
      const m=missionData[behavior]?.[mi];
      const payload={
        class_id:activeClass.id,child_id:st.childId,lesson_date:todayISO(),
        teacher_id:activeTeacherProfile.id,area:selectedGrowthArea,
        behavior,mission:m?.q||"",expansion_questions:m?.ex||[],
        observation_text:getParentGrowthDescription(behavior)
      };
      const {error}=await db.from("growth_records").upsert(payload,{onConflict:"class_id,child_id,lesson_date"});
      if(error) throw error;
      await db.from("attendance").upsert({class_id:activeClass.id,child_id:st.childId,lesson_date:todayISO(),status:"present"},{onConflict:"class_id,child_id,lesson_date"});
      st.complete=true;st.dirty=false;st.absent=false;
      window.updateStudentEditUI?.(currentTeacherStudent);
      window.updateLessonProgress?.();
      notify(currentTeacherStudent+" 기록을 저장했습니다.");
    }catch(e){notify("기록 저장 실패: "+e.message);}
  };

  window.toggleCurrentStudentAbsent=async function(){
    const st=studentRecordState[currentTeacherStudent];
    if(!st||!activeClass) return;
    try{
      const next=!st.absent;
      if(next){
        const {error}=await db.from("attendance").upsert({class_id:activeClass.id,child_id:st.childId,lesson_date:todayISO(),status:"absent"},{onConflict:"class_id,child_id,lesson_date"});
        if(error) throw error;
        await db.from("growth_records").delete().eq("class_id",activeClass.id).eq("child_id",st.childId).eq("lesson_date",todayISO());
        if(prodPhotos.length){
          await db.from("photo_assignments").delete().eq("child_id",st.childId).in("photo_id",prodPhotos.map(p=>p.id));
        }
        st.absent=true;st.complete=true;st.dirty=false;st.photos.clear();
      }else{
        await db.from("attendance").upsert({class_id:activeClass.id,child_id:st.childId,lesson_date:todayISO(),status:"present"},{onConflict:"class_id,child_id,lesson_date"});
        st.absent=false;st.complete=false;st.dirty=false;
      }
      window.updateStudentEditUI?.(currentTeacherStudent);
      window.updateLessonProgress?.();
      notify(next?currentTeacherStudent+" 학생을 결석 처리했습니다.":"결석 처리를 취소했습니다.");
    }catch(e){notify("결석 처리 실패: "+e.message);}
  };

  async function loadTeacherInquiries(){
    const list=$("teacherInquiryList"); if(!list||!activeTeacherProfile) return;
    const {data,error}=await db.from("inquiries")
      .select("id,type,content,status,created_at,children(name),classes(program,centers(name))")
      .eq("target","teacher").eq("assigned_teacher_id",activeTeacherProfile.id)
      .order("created_at",{ascending:false});
    if(error) throw error;
    list.innerHTML="";
    (data||[]).forEach(x=>{
      const card=document.createElement("div");card.className="inquiry-card";
      card.innerHTML=`<div class="inquiry-meta"><b>${escape(x.children?.name||"")} 학부모</b>
        <span class="badge">${escape(x.type)}</span>
        <span class="badge ${x.status==="read"?"gray":"warn"} inquiry-status">${x.status==="read"?"확인함":"확인 전"}</span></div>
        <p>${escape(x.content)}</p><div class="row" style="margin-top:12px"><button class="btn small ghost">${x.status==="read"?"확인함":"읽음 처리"}</button></div>`;
      q("button",card).onclick=async()=>{
        const next=x.status==="read"?"unread":"read";
        const {error}=await db.from("inquiries").update({status:next}).eq("id",x.id);
        if(error)return notify(error.message);
        await loadTeacherInquiries();
      };
      list.appendChild(card);
    });
    if(!(data||[]).length) list.innerHTML='<div class="prod-empty">학부모 문의가 없습니다.</div>';
    if($("teacherUnreadCount")){
      const n=(data||[]).filter(x=>x.status==="unread").length;
      $("teacherUnreadCount").textContent=n;$("teacherUnreadCount").classList.toggle("hide",n===0);
    }
  }

  // ---------- Admin ----------
  async function loadAdminDashboard(){
    await Promise.all([
      renderAdminClasses(),
      renderAdminMembers(),
      renderAdminFees(),
      renderAdminInquiries(),
      renderAdminTodayTomorrow(),
      renderAdminMonthlyProd()
    ]);
    await renderAdminTopStats();
  }

  async function renderAdminTopStats(){
    const wd=weekdayChar();
    const {data:todayClasses,error:cErr}=await db.from("classes")
      .select("id").eq("status","운영중").eq("weekday",wd);
    if(cErr) throw cErr;

    let completedClasses=0;
    for(const c of todayClasses||[]){
      const total=(await db.from("enrollments").select("*",{count:"exact",head:true}).eq("class_id",c.id).eq("active",true)).count||0;
      if(!total) continue;
      const gr=(await db.from("growth_records").select("child_id").eq("class_id",c.id).eq("lesson_date",todayISO())).data||[];
      const ab=(await db.from("attendance").select("child_id").eq("class_id",c.id).eq("lesson_date",todayISO()).eq("status","absent")).data||[];
      if(new Set([...gr.map(x=>x.child_id),...ab.map(x=>x.child_id)]).size>=total) completedClasses++;
    }
    const totalToday=(todayClasses||[]).length;
    const rate=totalToday?Math.round(completedClasses/totalToday*100):0;

    const {count:unread}=await db.from("inquiries")
      .select("*",{count:"exact",head:true}).eq("status","unread");

    if($("prodAdminTodayCount")) $("prodAdminTodayCount").textContent=String(totalToday);
    if($("prodAdminTodayRate")) $("prodAdminTodayRate").textContent=rate+"%";
    if($("prodAdminUnreadCount")) $("prodAdminUnreadCount").textContent=String(unread||0);
  }

  async function getOrCreateCenter(name){
    const n=name.trim();
    let {data,error}=await db.from("centers").select("id,name").eq("name",n).maybeSingle();
    if(error) throw error;
    if(data) return data;
    const res=await db.from("centers").insert({name:n}).select("id,name").single();
    if(res.error) throw res.error;
    return res.data;
  }

  async function resolveTeacherByName(name){
    const {data,error}=await db.from("profiles").select("id,name").eq("role","teacher").eq("active",true).eq("name",name.trim());
    if(error) throw error;
    if(data.length!==1) throw new Error(data.length?"동일한 이름의 강사가 여러 명입니다.":"등록된 강사 이름을 정확히 입력해주세요.");
    return data[0];
  }

  async function renderAdminClasses(){
    const body=$("adminClassBody");if(!body)return;
    const {data,error}=await db.from("classes")
      .select("id,term,program,weekday,class_time,teacher_id,student_capacity,status,class_amount,join_code,centers(id,name),profiles!classes_teacher_id_fkey(id,name)")
      .order("created_at",{ascending:false});
    if(error) throw error;
    body.innerHTML="";
    (data||[]).forEach(c=>{
      const tr=document.createElement("tr");
      tr.dataset.classId=c.id;tr.dataset.joinCode=c.join_code||"";
      const vals=[c.centers?.name||"",c.term,c.program,`${c.weekday} ${String(c.class_time).slice(0,5)}`,c.profiles?.name||"",`${c.student_capacity||0}명`,c.class_amount?money(c.class_amount):"미입력"];
      vals.forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.appendChild(td);});
      const td=document.createElement("td");td.innerHTML=`<span class="badge ${c.status==="운영중"?"":"gray"}">${escape(c.status)}</span>`;tr.appendChild(td);
      tr.onclick=()=>openAdminClassEditProd(c);
      body.appendChild(tr);
    });
    prepareResponsiveTables();
  }

  function openAdminClassEditProd(c){
    adminEditingClassId=c.id;
    $("editClassCenter").value=c.centers?.name||"";
    $("editClassTerm").value=c.term||"";
    $("editClassProgram").value=c.program||"블록동화";
    $("editClassTime").value=`${c.weekday} ${String(c.class_time).slice(0,5)}`;
    $("editClassTeacher").value=c.profiles?.name||"";
    $("editClassStudents").value=c.student_capacity||0;
    $("editClassAmount").value=c.class_amount||"";
    $("editClassStatus").value=c.status||"운영중";
    $("adminClassEditForm")?.classList.remove("hide");
  }

  window.closeAdminClassEdit=function(){
    adminEditingClassId=null;$("adminClassEditForm")?.classList.add("hide");
  };

  function splitClassTime(raw){
    const m=String(raw||"").trim().match(/^([일월화수목금토])(?:요일)?\s*(\d{1,2}):(\d{2})$/);
    if(!m) throw new Error("요일/시간을 '화 14:30' 형식으로 입력해주세요.");
    return {weekday:m[1],class_time:`${String(m[2]).padStart(2,"0")}:${m[3]}:00`};
  }

  window.addAdminClass=async function(){
    try{
      const center=await getOrCreateCenter($("newClassCenter").value);
      const teacher=await resolveTeacherByName($("newClassTeacher").value);
      const time=splitClassTime($("newClassTime").value);
      const payload={
        center_id:center.id,term:$("newClassTerm").value.trim(),program:$("newClassProgram").value,
        ...time,teacher_id:teacher.id,student_capacity:Number($("newClassStudents").value||0),
        class_amount:Number(String($("newClassAmount").value||"").replace(/\D/g,"")||0),
        status:$("newClassStatus").value
      };
      if(!payload.term) return notify("학기를 입력해주세요.");
      const {error}=await db.from("classes").insert(payload);
      if(error) throw error;
      $("adminClassForm")?.classList.add("hide");
      await loadAdminDashboard();
      notify("새 반을 등록했습니다.");
    }catch(e){notify("반 등록 실패: "+e.message);}
  };

  window.saveAdminClassEdit=async function(){
    if(!adminEditingClassId)return notify("수정할 반을 선택해주세요.");
    try{
      const center=await getOrCreateCenter($("editClassCenter").value);
      const teacher=await resolveTeacherByName($("editClassTeacher").value);
      const time=splitClassTime($("editClassTime").value);
      const payload={
        center_id:center.id,term:$("editClassTerm").value.trim(),program:$("editClassProgram").value,
        ...time,teacher_id:teacher.id,student_capacity:Number($("editClassStudents").value||0),
        class_amount:Number(String($("editClassAmount").value||"").replace(/\D/g,"")||0),
        status:$("editClassStatus").value
      };
      const {error}=await db.from("classes").update(payload).eq("id",adminEditingClassId);
      if(error) throw error;
      window.closeAdminClassEdit();
      await loadAdminDashboard();
      notify("반 정보를 수정했습니다.");
    }catch(e){notify("반 수정 실패: "+e.message);}
  };

  window.deleteAdminClass=async function(){
    if(!adminEditingClassId)return notify("삭제할 반을 선택해주세요.");
    if(!confirm("이 반을 삭제할까요? 연결된 강사 수업목록에서도 사라집니다."))return;
    const {error}=await db.from("classes").delete().eq("id",adminEditingClassId);
    if(error)return notify("삭제 실패: "+error.message);
    window.closeAdminClassEdit();
    await loadAdminDashboard();
    notify("반을 삭제했습니다.");
  };

  // Existing row delegated editor is disabled; production rows call their own handler.
  window.initAdminClassRowEditing=function(){};

  async function renderAdminMembers(){
    const {data,error}=await db.from("profiles").select("id,role,name,phone,active").in("role",["parent","teacher"]).order("name");
    if(error) throw error;
    const pb=$("parentMemberBody"),tb=$("teacherMemberBody");
    if(pb)pb.innerHTML="";if(tb)tb.innerHTML="";
    for(const p of data||[]){
      const body=p.role==="teacher"?tb:pb;if(!body)continue;
      const tr=document.createElement("tr");
      const detail=p.role==="teacher"?"강사 계정":"학부모 계정";
      tr.innerHTML=`<td>${escape(p.name||"")}</td><td>${detail}</td><td><span class="badge ${p.active?"":"gray"}">${p.active?"활성":"비활성"}</span></td>
        <td><input class="switch" id="active-${p.id}" type="checkbox" ${p.active?"checked":""}><label for="active-${p.id}" class="toggle"></label></td>
        <td><button class="btn ghost small" type="button">비밀번호 초기화</button></td>`;
      q("input",tr).onchange=async e=>{
        const {error}=await db.from("profiles").update({active:e.target.checked}).eq("id",p.id);
        if(error){notify(error.message);e.target.checked=!e.target.checked;return;}
        notify(e.target.checked?"로그인을 허용했습니다.":"로그인을 비활성화했습니다.");
      };
      q("button",tr).onclick=()=>notify("운영 초기에는 Supabase 관리자 또는 제공된 Edge Function으로 비밀번호를 초기화해주세요.");
      body.appendChild(tr);
    }
    prepareResponsiveTables();
  }

  async function ensureFees(){
    const {data:enrs,error}=await db.from("enrollments")
      .select("child_id,class_id,children(name),classes(program)");
    if(error) throw error;
    const map={"블록동화":"대여비 및 교재비","영어뮤지컬":"교구 및 교재비","스토리보드게임":"대여비 및 콘텐츠비"};
    const {data:existing}=await db.from("fees").select("child_id,class_id");
    const keys=new Set((existing||[]).map(x=>x.child_id+"|"+x.class_id));
    const missing=(enrs||[]).filter(x=>!keys.has(x.child_id+"|"+x.class_id)).map(x=>({
      child_id:x.child_id,class_id:x.class_id,program:x.classes?.program||"",
      item:map[x.classes?.program]||"추가비용",amount:0,visible:false,paid:false
    }));
    if(missing.length) await db.from("fees").insert(missing);
  }

  async function renderAdminFees(){
    await ensureFees();
    const body=q("#adminFeeTable tbody");if(!body)return;
    const {data,error}=await db.from("fees")
      .select("id,child_id,class_id,program,item,amount,visible,paid,children(name),classes(centers(name))")
      .order("created_at",{ascending:false});
    if(error) throw error;
    body.innerHTML="";
    (data||[]).forEach(f=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td>${escape(f.children?.name||"")}</td><td>${escape(f.classes?.centers?.name||"")}</td><td>${escape(f.program)}</td><td>${escape(f.item)}</td>
        <td><div class="fee-amount-editor"><input class="fee-amount-input" inputmode="numeric" value="${Number(f.amount||0).toLocaleString("ko-KR")}"><span>원</span></div></td>
        <td><input class="switch" id="fee-vis-${f.id}" type="checkbox" ${f.visible?"checked":""}><label for="fee-vis-${f.id}" class="toggle"></label></td>
        <td><button class="btn small ${f.paid?"ghost":""}">${f.paid?"완료":"입금확인"}</button></td>`;
      q(".fee-amount-input",tr).onchange=async e=>{
        const amount=Number(e.target.value.replace(/\D/g,"")||0);
        e.target.value=amount.toLocaleString("ko-KR");
        await db.from("fees").update({amount}).eq("id",f.id);
      };
      q("input.switch",tr).onchange=async e=>{await db.from("fees").update({visible:e.target.checked}).eq("id",f.id);};
      q("button",tr).onclick=async e=>{
        f.paid=!f.paid;await db.from("fees").update({paid:f.paid}).eq("id",f.id);
        e.target.textContent=f.paid?"완료":"입금확인";e.target.classList.toggle("ghost",f.paid);
      };
      body.appendChild(tr);
    });
    prepareResponsiveTables();
  }

  async function renderAdminInquiries(){
    const body=$("adminInquiryBody");if(!body)return;
    const {data,error}=await db.from("inquiries")
      .select("id,type,target,content,status,created_at,children(name),profiles!inquiries_assigned_teacher_id_fkey(name)")
      .order("created_at",{ascending:false});
    if(error) throw error;
    body.innerHTML="";
    (data||[]).forEach(x=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td>${escape(x.children?.name||"")}</td><td>${escape(x.type)}</td><td>${x.target==="teacher"?"담당 강사":"회사"}</td>
        <td>${escape(x.content)}</td><td>${escape(x.target==="teacher"?(x.profiles?.name||""):"관리자")}</td><td></td>`;
      const td=tr.lastElementChild;
      if(x.target==="company"){
        const b=document.createElement("button");b.className="btn small "+(x.status==="read"?"ghost":"danger");b.textContent=x.status==="read"?"확인함":"확인 전";
        b.onclick=async()=>{const next=x.status==="read"?"unread":"read";await db.from("inquiries").update({status:next}).eq("id",x.id);await renderAdminInquiries();};
        td.appendChild(b);
      }else td.innerHTML=`<span class="badge ${x.status==="read"?"gray":"warn"}">${x.status==="read"?"확인함":"확인 전"}</span>`;
      body.appendChild(tr);
    });
    prepareResponsiveTables();
  }

  async function renderAdminTodayTomorrow(){
    const all=await db.from("classes").select("id,term,program,weekday,class_time,status,teacher_id,centers(name),profiles!classes_teacher_id_fkey(name)").eq("status","운영중");
    if(all.error) throw all.error;
    const td=$("adminTodayClassBody"),tm=$("adminTomorrowClassBody");
    if(td)td.innerHTML="";if(tm)tm.innerHTML="";
    const now=new Date(), tomorrow=new Date(now);tomorrow.setDate(now.getDate()+1);
    for(const c of all.data||[]){
      if(c.weekday===weekdayChar(now) && td){
        const total=(await db.from("enrollments").select("*",{count:"exact",head:true}).eq("class_id",c.id).eq("active",true)).count||0;
        const g=(await db.from("growth_records").select("child_id").eq("class_id",c.id).eq("lesson_date",todayISO())).data||[];
        const a=(await db.from("attendance").select("child_id,status").eq("class_id",c.id).eq("lesson_date",todayISO()).eq("status","absent")).data||[];
        const done=new Set([...g.map(x=>x.child_id),...a.map(x=>x.child_id)]).size;
        const tr=document.createElement("tr");
        tr.innerHTML=`<td>${escape(c.centers?.name||"")}</td><td>${escape(c.term)}</td><td>${escape(c.program)}</td><td>${String(c.class_time).slice(0,5)}</td><td>${escape(c.profiles?.name||"")}</td><td><b>${done>=total&&total?"전원완료":`${done} / ${total}명`}</b></td>`;
        tr.onclick=()=>renderTodayDetailProd(c,total,g,a);
        td.appendChild(tr);
      }
      if(c.weekday===weekdayChar(tomorrow) && tm){
        const count=(await db.from("enrollments").select("*",{count:"exact",head:true}).eq("class_id",c.id).eq("active",true)).count||0;
        const tr=document.createElement("tr");tr.innerHTML=`<td>${escape(c.centers?.name||"")}</td><td>${escape(c.term)}</td><td>${escape(c.program)}</td><td>${String(c.class_time).slice(0,5)}</td><td>${escape(c.profiles?.name||"")}</td><td>${count}명</td>`;tm.appendChild(tr);
      }
    }
    prepareResponsiveTables();
  }

  async function renderTodayDetailProd(c,total,g,a){
    const detail=$("adminTodayClassDetail");if(!detail)return;
    const absentIds=new Set(a.map(x=>x.child_id));
    let absentNames=[];
    if(absentIds.size){
      const res=await db.from("children").select("id,name").in("id",[...absentIds]);absentNames=(res.data||[]).map(x=>x.name);
    }
    const {count:photoCount}=await db.from("photos").select("*",{count:"exact",head:true}).eq("class_id",c.id).eq("lesson_date",todayISO());
    detail.classList.remove("hide");
    detail.innerHTML=`<div class="row between"><div><b style="font-size:18px">${escape(c.centers?.name||"")} · ${escape(c.term)} · ${escape(c.program)}</b><div class="muted">${String(c.class_time).slice(0,5)} · ${escape(c.profiles?.name||"")} 강사 · 학생 ${total}명</div></div></div>
      <div class="grid three" style="margin-top:12px"><div class="stat"><b>${g.length}명</b><span>성장기록 완료</span></div><div class="stat"><b>${a.length}명</b><span>결석</span></div><div class="stat"><b>${photoCount||0}장</b><span>오늘 활동사진</span></div></div>
      <div class="record" style="margin-top:12px"><b>결석한 아이</b><div class="muted" style="margin-top:5px">${escape(absentNames.join(", ")||"없음")}</div></div>`;
  }

  function countWeekday(monthValue,weekday){
    const [y,m]=monthValue.split("-").map(Number), idx=["일","월","화","수","목","금","토"].indexOf(weekday);
    let n=0;for(let d=1;d<=new Date(y,m,0).getDate();d++)if(new Date(y,m-1,d).getDay()===idx)n++;return n;
  }

  async function renderAdminMonthlyProd(){
    const input=$("adminMonthlyMonth"),root=$("adminMonthlyTeacherGroups");if(!input||!root)return;
    if(!input.value) input.value=todayISO().slice(0,7);
    const month=input.value;
    const {data:classes,error}=await db.from("classes").select("id,weekday,status,teacher_id,created_at,centers(name),profiles!classes_teacher_id_fkey(name)").neq("status","종료");
    if(error) throw error;
    const groups={};
    for(const c of classes||[]){
      const scheduled=countWeekday(month,c.weekday);
      const key=(c.profiles?.name||"")+"|"+(c.centers?.name||"");
      groups[key] ||= {teacher:c.profiles?.name||"",center:c.centers?.name||"",scheduled:0,completed:0};
      groups[key].scheduled+=scheduled;

      const [y,m]=month.split("-").map(Number);
      for(let d=1;d<=new Date(y,m,0).getDate();d++){
        const date=new Date(y,m-1,d);
        if(weekdayChar(date)!==c.weekday)continue;
        const ds=`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        const total=(await db.from("enrollments").select("*",{count:"exact",head:true}).eq("class_id",c.id).eq("active",true)).count||0;
        if(!total)continue;
        const gr=(await db.from("growth_records").select("child_id").eq("class_id",c.id).eq("lesson_date",ds)).data||[];
        const ab=(await db.from("attendance").select("child_id").eq("class_id",c.id).eq("lesson_date",ds).eq("status","absent")).data||[];
        if(new Set([...gr.map(x=>x.child_id),...ab.map(x=>x.child_id)]).size>=total) groups[key].completed++;
      }
    }
    const vals=Object.values(groups);
    const ts=vals.reduce((s,x)=>s+x.scheduled,0),tc=vals.reduce((s,x)=>s+x.completed,0);
    if($("adminMonthlyScheduledCount")) $("adminMonthlyScheduledCount").textContent=ts+"회";
    if($("adminMonthlyCompletedSessions")) $("adminMonthlyCompletedSessions").textContent=tc+"회";
    if($("adminMonthlyCompletionRate")) $("adminMonthlyCompletionRate").textContent=(ts?Math.round(tc/ts*100):0)+"%";

    const byTeacher={};vals.forEach(g=>{byTeacher[g.teacher] ||= [];byTeacher[g.teacher].push(g);});
    root.innerHTML="";
    Object.entries(byTeacher).sort().forEach(([teacher,centers])=>{
      const s=centers.reduce((a,x)=>a+x.scheduled,0),c=centers.reduce((a,x)=>a+x.completed,0);
      const card=document.createElement("div");card.className="admin-monthly-teacher-card";
      card.innerHTML=`<div class="admin-monthly-teacher-head"><div><div class="admin-monthly-teacher-name">${escape(teacher)} 강사</div><div class="muted">담당 센터 ${centers.length}곳</div></div><div class="admin-monthly-teacher-rate"><span class="muted">월 전체</span><b>${c} / ${s}회 완료</b><strong>${s?Math.round(c/s*100):0}%</strong></div></div><div class="admin-monthly-centers"></div>`;
      const box=q(".admin-monthly-centers",card);
      centers.forEach(x=>{
        const row=document.createElement("div");row.className="admin-monthly-center-row";
        row.innerHTML=`<div class="admin-monthly-center-name">${escape(x.center)}</div><div class="admin-monthly-center-cell"><span class="admin-monthly-center-label">전체 수업</span><span>${x.scheduled}회</span></div><div class="admin-monthly-center-cell"><span class="admin-monthly-center-label">전원완료</span><span>${x.completed}회</span></div><div class="admin-monthly-center-cell"><span class="admin-monthly-center-label">미완료</span><span>${Math.max(x.scheduled-x.completed,0)}회</span></div><div class="admin-monthly-center-cell"><span class="admin-monthly-center-label">완료율</span><span class="admin-monthly-center-rate">${x.scheduled?Math.round(x.completed/x.scheduled*100):0}%</span></div>`;
        box.appendChild(row);
      });
      root.appendChild(card);
    });
    if(!vals.length) root.innerHTML='<div class="prod-empty">해당 월에 집계할 수업이 없습니다.</div>';
  }
  window.renderAdminMonthlyTracking=renderAdminMonthlyProd;

  // ---------- Realtime ----------
  function subscribeRealtime(){
    if(realtimeChannel) return;
    realtimeChannel=db.channel("growlog-live")
      .on("postgres_changes",{event:"*",schema:"public",table:"classes"},refreshVisible)
      .on("postgres_changes",{event:"*",schema:"public",table:"growth_records"},refreshVisible)
      .on("postgres_changes",{event:"*",schema:"public",table:"attendance"},refreshVisible)
      .on("postgres_changes",{event:"*",schema:"public",table:"photo_assignments"},refreshVisible)
      .on("postgres_changes",{event:"*",schema:"public",table:"fees"},refreshVisible)
      .on("postgres_changes",{event:"*",schema:"public",table:"inquiries"},refreshVisible)
      .subscribe();
  }
  let refreshTimer=null;
  function refreshVisible(){
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(async()=>{
      if(!profile)return;
      const visible=["parent","teacher","admin"].find(id=>!$(id)?.classList.contains("hide"));
      if(visible==="parent") await loadParentDashboard(profile.role==="admin");
      if(visible==="teacher") await loadTeacherDashboard(profile.role==="admin");
      if(visible==="admin") await loadAdminDashboard();
    },350);
  }

  // ---------- Init ----------
  async function init(){
    q(".roles")?.classList.add("hide");
    q(".mobile-nav")?.classList.add("hide");
    $("prodLogoutBtn")?.classList.add("hide");

    try{
      if(!window.supabase || typeof window.supabase.createClient!=="function"){
        setupError("Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결 또는 CDN 로딩을 확인해주세요.");
        showAuth();
        return;
      }

      if(!configured){
        setupError("config.js 설정을 읽지 못했습니다. SUPABASE_URL과 Publishable Key가 들어있는지 확인해주세요.");
        showAuth();
        return;
      }

      if(!/^https:\/\/.+\.supabase\.co\/?$/i.test(cfg.SUPABASE_URL)){
        setupError("Supabase Project URL 형식이 올바르지 않습니다. URL 값만 넣어주세요. 예: https://xxxx.supabase.co");
        showAuth();
        return;
      }

      db = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });

      if($("prodLogoutBtn")) $("prodLogoutBtn").onclick=logout;
      qa(".roles button,.mobile-nav button").forEach(btn=>btn.onclick=()=>switchRoleProd(btn.dataset.role));

      const {data,error}=await db.auth.getSession();
      if(error) throw error;
      session=data.session;

      db.auth.onAuthStateChange((event,newSession)=>{
        session=newSession;
        if(event==="SIGNED_OUT") showAuth();
      });

      if(session){
        try{ await routeAuthenticated(); }
        catch(e){ notify(e.message); showAuth(); }
      }else{
        showAuth();
      }
    }catch(e){
      console.error("Growlog Supabase init error:", e);
      db=null;
      setupError("Supabase 연결 시작 중 오류가 났습니다: "+(e?.message || e));
      showAuth();
    }
  }

  document.addEventListener("DOMContentLoaded",init,{once:true});
})();
