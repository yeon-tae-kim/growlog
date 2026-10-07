
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
  let adminEditingClassId = null;
  let prodPhotos = [];
  let realtimeChannel = null;
  let activeLessonDate = null;
  let teacherSessionCache = [];
  let parentActiveEnrollments = [];
  let adminChildClassChildren = [];
  let adminChildClassClasses = [];
  let adminParentPreviewRows = [];
  let adminParentPreviewClassId = null;
  let adminTodayDetailClassId = null;

  const GROWTH_AREA_META = {
    "자기조절": { icon:"🧘" },
    "도전": { icon:"🚀" },
    "협력": { icon:"🤝" },
    "배려": { icon:"💗" },
    "표현": { icon:"💬" },
    "책임": { icon:"✅" }
  };
  const GROWTH_AREA_ORDER = ["자기조절","도전","협력","배려","표현","책임"];
  const growthIcon = area => GROWTH_AREA_META[area]?.icon || "🌱";

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
      const email = ($("parentPhone")?.value || "").trim().toLowerCase();
      const password = $("parentPassword")?.value || "";
      if (!email || !email.includes("@") || !password) return notify("이메일과 비밀번호를 확인해주세요.");

      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      session = data.session;
      await finishPendingParentRegistration();
      await routeAuthenticated();
      notify("로그인했습니다.");
    }catch(e){ notify("로그인 실패: "+e.message); }
  };

  const PENDING_PARENT_KEY = "growlog_pending_parent_signup_v10";

  function savePendingParentRegistration(data){
    try{ localStorage.setItem(PENDING_PARENT_KEY, JSON.stringify(data)); }catch(_){}
  }

  function readPendingParentRegistration(){
    try{
      const raw=localStorage.getItem(PENDING_PARENT_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(_){ return null; }
  }

  function clearPendingParentRegistration(){
    try{ localStorage.removeItem(PENDING_PARENT_KEY); }catch(_){}
  }

  async function finishPendingParentRegistration(){
    if(!session?.user) return false;
    const pending=readPendingParentRegistration();
    if(!pending) return false;
    if((session.user.email||"").toLowerCase() !== String(pending.email||"").toLowerCase()) return false;

    const { error:rpcError } = await db.rpc("register_parent_child",{
      p_guardian_name:pending.guardian,
      p_child_name:pending.child,
      p_birth_date:pending.birth,
      p_join_code:pending.joinCode
    });
    if(rpcError) throw rpcError;

    clearPendingParentRegistration();
    return true;
  }

  window.completeDemoSignup = async function(){
    if (!db) return;
    try{
      const guardian = ($("guardianName")?.value || "").trim();
      const email = ($("signupEmail")?.value || "").trim().toLowerCase();
      const password = $("newPassword")?.value || "";
      const child = ($("childName")?.value || "").trim();
      const birth = $("childBirth")?.value || "";
      const agree = $("agreeRequired")?.checked;
      const joinCode = joinCodeFromUrl();

      if (!guardian || !email || !email.includes("@") || password.length < 8 || !child || !birth){
        return notify("필수 정보를 모두 입력해주세요. 이메일을 확인하고 비밀번호는 8자 이상으로 설정해주세요.");
      }
      if (!agree) return notify("필수 동의 항목을 확인해주세요.");
      if (!joinCode) return notify("센터의 수업 QR을 통해 접속해주세요.");

      const pending={guardian,email,child,birth,joinCode};
      savePendingParentRegistration(pending);

      const { data, error } = await db.auth.signUp({
        email,
        password,
        options:{ data:{ guardian_name:guardian } }
      });

      if(error){
        const msg=String(error.message||"");
        if(/already|registered|exists/i.test(msg)){
          notify("이미 가입된 이메일입니다. 로그인 탭에서 기존 계정으로 로그인해주세요.");
          if($("parentPhone")) $("parentPhone").value=email;
          if(typeof window.showAuthPanel==="function") window.showAuthPanel("login");
          return;
        }
        throw error;
      }

      session=data.session || null;

      if(!session){
        $("signupMessage")?.classList.add("show");
        if($("signupMessage")) $("signupMessage").textContent=
          "이메일 확인이 필요한 설정입니다. 받은 메일에서 확인한 뒤 같은 이메일로 로그인하면 아이와 수업이 자동 연결됩니다.";
        notify("가입 요청이 완료되었습니다. 이메일 확인 후 로그인해주세요.");
        return;
      }

      await finishPendingParentRegistration();
      profile = await getProfile(session.user.id);
      $("signupMessage")?.classList.add("show");
      await routeAuthenticated();
      notify("회원가입이 완료되었습니다.");
    }catch(e){
      notify("회원가입 실패: "+(e?.message || e));
    }
  };

  async function logout(){
    if (!db) return;
    await db.auth.signOut();
    session = null; profile = null; activeClass=null; activeChild=null; activeEnrollment=null;
    if (realtimeChannel){ await db.removeChannel(realtimeChannel); realtimeChannel=null; }
    showAuth();
  }

  function prepareParentProductionShell(){
    const legacyCourse=$("courseSummer")?.closest(".card");
    const courseCard=$("parentCourseCard") || legacyCourse;
    if(courseCard){
      courseCard.id="parentCourseCard";
      courseCard.innerHTML='<h2>📚 수강 기록</h2><div id="prodCourseList"><div class="prod-empty">연결된 아이의 수강 기록이 표시됩니다.</div></div>';
    }

    const pool=$("parentActivityPhotos");
    if(pool){
      pool.innerHTML='<div class="photo-empty">활동사진을 불러오고 있어요.</div>';
      const photoCard=pool.closest(".card");
      if(photoCard){
        qa(".photo",photoCard).forEach(el=>{ if(!pool.contains(el)) el.remove(); });
      }
    }

    const caption=$("parentPhotoCaption") || $("parentActivityPhotos")?.closest(".card")?.querySelector("p.muted");
    if(caption){
      caption.id="parentPhotoCaption";
      caption.textContent="연결된 아이의 사진만 보여집니다.";
    }

    const inquiryCard=$("parentInquiryCard") || $("parentInquiryType")?.closest(".card");
    if(inquiryCard) inquiryCard.id="parentInquiryCard";

    const target=$("parentInquiryTarget");
    if(target) target.innerHTML='<option value="teacher">담당 강사에게</option><option value="company">회사에 문의</option>';

    if($("parentGrowthMapTitle")) $("parentGrowthMapTitle").textContent="🌈 누적 성장지도";
    if($("parentGrowthMapTotal")) $("parentGrowthMapTotal").textContent="0개 기록";
    if($("parentGrowthRadar")) $("parentGrowthRadar").innerHTML="";
    if($("parentGrowthLegend")) $("parentGrowthLegend").innerHTML='<div class="prod-empty">아이 연결 후 누적 성장기록이 표시됩니다.</div>';
  }

  async function updateParentInquiryTeacher(){
    const target=$("parentInquiryTarget");
    if(!target) return;
    let teacherName="";
    if(activeClass?.teacher_id){
      const {data}=await db.from("profiles").select("name").eq("id",activeClass.teacher_id).maybeSingle();
      teacherName=data?.name || "";
    }
    target.innerHTML=
      `<option value="teacher">${teacherName ? "담당 강사에게 · "+escape(teacherName)+" 선생님" : "담당 강사에게"}</option>`+
      '<option value="company">회사에 문의</option>';
  }

  async function renderParentNextClassChooser(){
    const card=$("parentNextClassCard");
    const select=$("parentNextClassSelect");
    const button=$("parentNextClassButton");
    const help=$("parentNextClassHelp");
    if(!card||!select||!button||!activeChild)return;

    card.classList.remove("hide");
    select.innerHTML='<option value="">선택 가능한 수업을 불러오는 중...</option>';
    select.disabled=true;
    button.disabled=true;

    const {data,error}=await db.rpc("list_available_next_classes",{p_child_id:activeChild.id});
    if(error){
      select.innerHTML='<option value="">수업 목록을 불러오지 못했습니다.</option>';
      if(help) help.textContent="잠시 후 다시 시도해주세요.";
      return;
    }

    const rows=data||[];
    select.innerHTML="";
    if(!rows.length){
      select.add(new Option("현재 선택할 수 있는 새 수업이 없습니다.",""));
      select.disabled=true;
      button.disabled=true;
      if(help) help.textContent="관리자가 다음 수업을 등록하면 이곳에 자동으로 표시됩니다.";
      return;
    }

    select.add(new Option("다음 수업을 선택해주세요.",""));
    rows.forEach(c=>{
      const time=String(c.class_time||"").slice(0,5);
      const status=c.status==="예정"?"예정":"운영중";
      select.add(new Option(
        `${c.center_name||""} · ${c.term||""} · ${c.program||""} · ${c.weekday||""} ${time} · ${status}`,
        c.id
      ));
    });
    select.disabled=false;
    button.disabled=false;
    if(help) help.textContent="새로운 QR이나 회원가입은 필요하지 않습니다.";
  }

  window.chooseParentNextClass=async function(){
    if(!activeChild)return notify("연결된 아이가 없습니다.");
    const classId=$("parentNextClassSelect")?.value||"";
    if(!classId)return notify("다음 수업을 선택해주세요.");

    const text=$("parentNextClassSelect")?.selectedOptions?.[0]?.textContent||"선택한 수업";
    if(!confirm(`${text}\n\n이 수업으로 아이의 성장기록을 이어갈까요?`))return;

    const btn=$("parentNextClassButton");
    if(btn){btn.disabled=true;btn.textContent="연결 중...";}
    try{
      const {error}=await db.rpc("parent_choose_next_class",{
        p_child_id:activeChild.id,
        p_class_id:classId
      });
      if(error)throw error;
      notify("다음 수업이 연결되었습니다. 기존 성장기록도 그대로 이어집니다.");
      await renderParentForChild();
    }catch(e){
      notify("수업 연결 실패: "+(e?.message||e));
    }finally{
      if(btn){btn.disabled=false;btn.textContent="이 수업으로 이어가기";}
    }
  };

  // ---------- Parent ----------
  async function getParentChildren(){
    let query = db.from("children").select("id,name,birth_date,parent_id").order("created_at");
    if (profile.role!=="admin") query = query.eq("parent_id",profile.id);
    const {data,error}=await query;
    if(error) throw error;
    return data||[];
  }

  async function loadParentDashboard(adminPreview=false){
    if(adminPreview){
      const {data:rows,error}=await db.from("enrollments")
        .select("id,child_id,class_id,active,created_at,children(id,name,birth_date,parent_id),classes(id,term,program,weekday,class_time,status,start_date,end_date,class_amount,center_id,teacher_id,centers(name))")
        .order("created_at",{ascending:false});
      if(error) throw error;

      adminParentPreviewRows=(rows||[]).filter(r=>r.children && r.classes);
      if(!adminParentPreviewRows.length){
        activeChild=null;
        adminParentPreviewClassId=null;
        ensureAdminParentPreviewSelector([]);
        renderParentEmpty("미리보기할 수강생이 없습니다.");
        return;
      }

      let selected=
        adminParentPreviewRows.find(r=>r.class_id===adminParentPreviewClassId && r.child_id===activeChild?.id)
        || adminParentPreviewRows.find(r=>r.active && r.classes?.status!=="종료")
        || adminParentPreviewRows[0];

      activeChild=selected.children;
      adminParentPreviewClassId=selected.class_id;
      ensureAdminParentPreviewSelector(adminParentPreviewRows);
      await renderParentForChild();
      return;
    }

    adminParentPreviewRows=[];
    adminParentPreviewClassId=null;
    q('.prod-admin-preview[data-kind="parent"]',$("parent"))?.remove();

    const children = await getParentChildren();
    if (!children.length){
      activeChild=null;
      renderParentEmpty("연결된 아이가 없습니다.");
      return;
    }
    activeChild = children[0];
    await renderParentForChild();
  }

  function ensureAdminParentPreviewSelector(rows){
    const root=$("parent");
    if(!root)return;
    let box=q('.prod-admin-preview[data-kind="parent"]',root);
    if(!box){
      box=document.createElement("div");
      box.dataset.kind="parent";
      root.prepend(box);
    }
    box.className="prod-admin-preview admin-preview-panel";

    if(!rows.length){
      box.innerHTML=`
        <div class="preview-heading">
          <span class="preview-eyebrow">관리자 미리보기</span>
          <span class="preview-page-title">학부모 페이지</span>
        </div>
        <div class="preview-note">연결된 수강생이 없습니다.</div>`;
      return;
    }

    const classMap=new Map();
    rows.forEach(r=>{
      if(!classMap.has(r.class_id)) classMap.set(r.class_id,r.classes);
    });
    const classes=[...classMap.entries()];
    if(!classMap.has(adminParentPreviewClassId)) adminParentPreviewClassId=classes[0]?.[0]||null;

    const classOptions=classes.map(([id,c])=>{
      const status=c.status==="종료"?" · 종료":"";
      const label=`${c.centers?.name||""} · ${c.term||""} · ${c.program||""} · ${c.weekday||""} ${String(c.class_time||"").slice(0,5)}${status}`;
      return `<option value="${escape(id)}"${id===adminParentPreviewClassId?" selected":""}>${escape(label)}</option>`;
    }).join("");

    const students=rows.filter(r=>r.class_id===adminParentPreviewClassId);
    if(!students.some(r=>r.child_id===activeChild?.id) && students[0]) activeChild=students[0].children;
    const studentOptions=students.map(r=>{
      const birth=r.children?.birth_date ? ` · ${r.children.birth_date}` : "";
      return `<option value="${escape(r.child_id)}"${r.child_id===activeChild?.id?" selected":""}>${escape((r.children?.name||"")+birth)}</option>`;
    }).join("");

    box.innerHTML=`
      <div class="preview-heading">
        <span class="preview-eyebrow">관리자 미리보기</span>
        <span class="preview-page-title">학부모 페이지</span>
      </div>
      <div class="preview-fields">
        <div class="preview-field"><label>수업</label><select data-preview-class>${classOptions}</select></div>
        <div class="preview-field"><label>아이</label><select data-preview-child>${studentOptions}</select></div>
      </div>
      <div class="preview-note">관리자에게만 보이는 선택창입니다. 선택한 수업과 아이 기준으로 실제 학부모 화면을 확인합니다.</div>`;

    q("[data-preview-class]",box).onchange=async e=>{
      adminParentPreviewClassId=e.target.value;
      const candidates=adminParentPreviewRows.filter(r=>r.class_id===adminParentPreviewClassId);
      if(candidates[0]) activeChild=candidates[0].children;
      ensureAdminParentPreviewSelector(adminParentPreviewRows);
      await renderParentForChild();
    };

    q("[data-preview-child]",box).onchange=async e=>{
      const row=adminParentPreviewRows.find(r=>r.class_id===adminParentPreviewClassId && r.child_id===e.target.value);
      if(!row)return;
      activeChild=row.children;
      await renderParentForChild();
    };
  }

  function ensureAdminPreviewSelector(kind,items,onChange){
    const root = kind==="parent" ? $("parent") : $("teacherClassSelectView");
    if (!root) return;
    let box = q(`.prod-admin-preview[data-kind="${kind}"]`,root);
    if (!box){
      box=document.createElement("div");
      box.dataset.kind=kind;
      root.prepend(box);
    }
    const pageTitle=kind==="teacher"?"강사 페이지":"학부모 페이지";
    const fieldLabel=kind==="teacher"?"강사":"대상";
    box.className="prod-admin-preview admin-preview-panel one-field";
    box.innerHTML=`
      <div class="preview-heading">
        <span class="preview-eyebrow">관리자 미리보기</span>
        <span class="preview-page-title">${pageTitle}</span>
      </div>
      <div class="preview-fields">
        <div class="preview-field">
          <label>${fieldLabel}</label>
          <select>${items.map(x=>`<option value="${escape(x.id)}">${escape(x.label)}</option>`).join("")}</select>
        </div>
      </div>
      <div class="preview-note">관리자에게만 보이는 선택창입니다. 실제 운영 화면을 그대로 확인할 수 있습니다.</div>`;
    q("select",box).onchange=e=>onChange(e.target.value);
  }

  function renderParentEmpty(text){
    activeClass=null;
    activeEnrollment=null;
    currentParentStudentName="";

    const heroTitle=$("parentHeroTitle");
    if(heroTitle) heroTitle.textContent=text;
    if($("parentHeroText")) $("parentHeroText").textContent="아이가 연결되면 수강기록과 성장기록이 이곳에 표시됩니다.";

    $("parentTodayContent")?.classList.add("hide");
    $("parentAbsentNotice")?.classList.add("hide");
    $("feeNotice")?.classList.add("hide");
    $("parentInquiryCard")?.classList.add("hide");
    $("parentNextClassCard")?.classList.add("hide");
    $("parentActiveClassSwitcher")?.classList.add("hide");

    const courseCard=$("parentCourseCard");
    if(courseCard){
      courseCard.classList.remove("hide");
      courseCard.innerHTML='<h2>📚 수강 기록</h2><div id="prodCourseList"><div class="prod-empty">연결된 아이가 아직 없습니다.</div></div>';
    }

    const pool=$("parentActivityPhotos");
    if(pool) pool.innerHTML='<div class="photo-empty">연결된 아이가 아직 없습니다.</div>';
    if($("parentPhotoCaption")) $("parentPhotoCaption").textContent="아이 연결 후 활동사진이 표시됩니다.";

    const target=$("parentInquiryTarget");
    if(target) target.innerHTML='<option value="teacher">담당 강사에게</option><option value="company">회사에 문의</option>';
  }

  function parentActiveClassLabel(enr){
    const c=enr?.classes;
    if(!c)return "";
    return `${c.term||""} · ${c.program||""} · ${c.centers?.name||""} · ${c.weekday||""} ${String(c.class_time||"").slice(0,5)}`;
  }

  function renderParentActiveClassSwitcher(){
    const box=$("parentActiveClassSwitcher");
    const select=$("parentActiveClassSelect");
    if(!box||!select)return;

    if(parentActiveEnrollments.length<=1){
      box.classList.add("hide");
      select.innerHTML="";
      return;
    }

    box.classList.remove("hide");
    select.innerHTML="";
    parentActiveEnrollments.forEach(enr=>{
      select.add(new Option(parentActiveClassLabel(enr),enr.class_id));
    });
    if(activeEnrollment) select.value=activeEnrollment.class_id;
  }

  async function renderSelectedParentActiveClass(){
    if(!activeEnrollment || !activeClass)return;
    const display=shortName(activeChild.name);

    $("parentNextClassCard")?.classList.add("hide");
    $("parentInquiryCard")?.classList.remove("hide");
    if($("parentPhotoCaption")) $("parentPhotoCaption").textContent=
      `${display}의 ${activeClass.term||""} ${activeClass.program||""} 사진만 보여집니다.`;
    await updateParentInquiryTeacher();

    if(activeClass.status==="예정" || (activeClass.start_date && activeClass.start_date>todayISO())){
      $("parentTodayContent")?.classList.add("hide");
      $("parentAbsentNotice")?.classList.add("hide");
      if($("parentHeroTitle")) $("parentHeroTitle").textContent=display+"의 다음 수업이 연결되었어요. 🎒";
      if($("parentHeroText")) $("parentHeroText").textContent=
        `${activeClass.term||""} · ${activeClass.program||""} 수업이 시작되면 성장기록이 계속 이어집니다.`;
    }else{
      if($("parentHeroTitle")) $("parentHeroTitle").textContent=display+"의 오늘을 기록했어요. 😊";
      if($("parentHeroText")) $("parentHeroText").textContent="수업 속 작은 좋은 행동을 한 줄씩 쌓아갑니다.";
      await renderParentToday();
    }
    await renderParentFees();
  }

  window.changeParentActiveClass=async function(classId){
    const enr=parentActiveEnrollments.find(e=>e.class_id===classId);
    if(!enr)return;
    activeEnrollment=enr;
    activeClass=enr.classes||null;
    renderParentActiveClassSwitcher();
    await renderSelectedParentActiveClass();
  };

  async function renderParentForChild(){
    if(!activeChild) return;
    currentParentStudentName = activeChild.name;
    const display=shortName(activeChild.name);

    const {data:enrollments,error:e1}=await db.from("enrollments")
      .select("id,active,created_at,class_id,classes(id,term,program,weekday,class_time,start_date,end_date,status,class_amount,center_id,teacher_id,centers(name))")
      .eq("child_id",activeChild.id)
      .order("created_at",{ascending:false});
    if(e1) throw e1;

    // 관리자 학부모 미리보기에서는 위 선택창의 '수업 + 아이'를 그대로 사용합니다.
    if(profile?.role==="admin" && adminParentPreviewClassId){
      const previewEnrollment=(enrollments||[]).find(e=>e.class_id===adminParentPreviewClassId) || null;
      activeEnrollment=previewEnrollment;
      activeClass=previewEnrollment?.classes || null;
      parentActiveEnrollments=[];

      $("parentActiveClassSwitcher")?.classList.add("hide");
      $("parentNextClassCard")?.classList.add("hide");

      if(activeClass){
        if($("parentPhotoCaption")) $("parentPhotoCaption").textContent=
          `${display}의 ${activeClass.term||""} ${activeClass.program||""} 사진만 보여집니다.`;
        await updateParentInquiryTeacher();

        if(activeClass.status==="종료"){
          $("parentTodayContent")?.classList.add("hide");
          $("parentAbsentNotice")?.classList.add("hide");
          $("feeNotice")?.classList.add("hide");
          $("parentInquiryCard")?.classList.add("hide");
          if($("parentHeroTitle")) $("parentHeroTitle").textContent=`${display}의 지난 수업을 미리보고 있어요.`;
          if($("parentHeroText")) $("parentHeroText").textContent=
            `${activeClass.term||""} · ${activeClass.program||""} 종료 수업입니다. 아래 수강기록과 전체 누적 성장지도를 확인할 수 있어요.`;
        }else{
          $("parentInquiryCard")?.classList.remove("hide");
          await renderSelectedParentActiveClass();
        }
      }else{
        renderParentEmpty("선택한 수업 연결을 찾을 수 없습니다.");
      }

      await renderParentCourses(enrollments||[]);
      await renderParentGrowthMap();
      return;
    }

    parentActiveEnrollments=(enrollments||[]).filter(e=>e.active && e.classes && e.classes.status!=="종료");

    // 실제 학부모: 동시에 여러 수업 중 하나를 보고 있었다면 선택 유지
    if(activeEnrollment && parentActiveEnrollments.some(e=>e.class_id===activeEnrollment.class_id)){
      activeEnrollment=parentActiveEnrollments.find(e=>e.class_id===activeEnrollment.class_id);
    }else{
      activeEnrollment=parentActiveEnrollments[0] || null;
    }
    activeClass=activeEnrollment?.classes || null;

    renderParentActiveClassSwitcher();

    if(activeClass){
      await renderSelectedParentActiveClass();
    }else{
      $("parentActiveClassSwitcher")?.classList.add("hide");
      $("parentTodayContent")?.classList.add("hide");
      $("parentAbsentNotice")?.classList.add("hide");
      $("feeNotice")?.classList.add("hide");
      $("parentInquiryCard")?.classList.add("hide");
      if($("parentHeroTitle")) $("parentHeroTitle").textContent=display+"의 한 학기가 잘 마무리되었어요. 🌱";
      if($("parentHeroText")) $("parentHeroText").textContent="지난 성장기록은 그대로 보관돼요. 다음 수업을 선택하면 같은 성장기록으로 계속 이어집니다.";
      await renderParentNextClassChooser();
    }

    await renderParentCourses(enrollments||[]);
    await renderParentGrowthMap();
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

    // 결석에서 출석으로 다시 변경되었을 때
    // 결석용 문구가 화면에 남지 않도록 출석 상태 문구를 확실히 복원합니다.
    if($("parentHeroTitle")){
      $("parentHeroTitle").textContent=shortName(activeChild.name)+"의 오늘을 기록했어요. 😊";
    }
    if($("parentHeroText")){
      $("parentHeroText").textContent="수업 속 작은 좋은 행동을 한 줄씩 쌓아갑니다.";
    }

    const {data:record}=await db.from("growth_records")
      .select("*").eq("child_id",activeChild.id).eq("class_id",activeClass.id).eq("lesson_date",date).maybeSingle();

    if(record){
      if($("parentGrowthArea")){
        $("parentGrowthArea").textContent=`${growthIcon(record.area)} ${record.area||""}`;
        $("parentGrowthArea").classList.add("growth-area-badge");
      }
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
    let feeQuery=db.from("fees")
      .select("id,program,item,amount,visible,paid,class_id,classes(center_id,centers(name))")
      .eq("child_id",activeChild.id).eq("visible",true).eq("paid",false);
    if(activeClass?.id) feeQuery=feeQuery.eq("class_id",activeClass.id);
    const {data,error}=await feeQuery.order("created_at",{ascending:false}).limit(1);
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
    const old=$("parentCourseCard") || $("courseSummer")?.closest(".card");
    if(!old) return;
    old.id="parentCourseCard";
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
      row.innerHTML=`<b>${escape(rec.lesson_date)} · ${growthIcon(rec.area)} ${escape(rec.area||"")}</b>
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


  function radarPoint(cx,cy,r,index,total=6){
    const angle=(-Math.PI/2)+(Math.PI*2*index/total);
    return [cx+Math.cos(angle)*r,cy+Math.sin(angle)*r];
  }

  function renderGrowthRadar(counts){
    const svg=$("parentGrowthRadar"),legend=$("parentGrowthLegend");
    if(!svg||!legend)return;
    const cx=190,cy=172,maxR=112;
    const rings=[.25,.5,.75,1];
    const labelR=148;
    let markup="";

    rings.forEach(scale=>{
      const pts=GROWTH_AREA_ORDER.map((_,i)=>radarPoint(cx,cy,maxR*scale,i).map(n=>n.toFixed(1)).join(",")).join(" ");
      markup+=`<polygon class="grid-ring" points="${pts}"></polygon>`;
    });

    GROWTH_AREA_ORDER.forEach((area,i)=>{
      const [x,y]=radarPoint(cx,cy,maxR,i);
      markup+=`<line class="axis-line" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"></line>`;
    });

    // 누적 횟수가 늘수록 단조롭게 바깥으로 커지는 시각화입니다.
    // 점수화가 아니라 기록량 표현이므로 정확한 횟수는 라벨/범례에 따로 표시합니다.
    const values=GROWTH_AREA_ORDER.map(area=>{
      const n=Number(counts[area]||0);
      return n<=0 ? 0 : (1-Math.exp(-n/4));
    });
    const shapePts=values.map((v,i)=>radarPoint(cx,cy,maxR*v,i).map(n=>n.toFixed(1)).join(",")).join(" ");
    markup+=`<polygon class="growth-shape" points="${shapePts}"></polygon>`;
    values.forEach((v,i)=>{
      const [x,y]=radarPoint(cx,cy,maxR*v,i);
      markup+=`<circle class="growth-point" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.2"></circle>`;
    });

    GROWTH_AREA_ORDER.forEach((area,i)=>{
      const [x,y]=radarPoint(cx,cy,labelR,i);
      const anchor=x<cx-15?"end":x>cx+15?"start":"middle";
      const dy=y<cy-65?-5:y>cy+65?15:4;
      markup+=`<text class="axis-label" x="${x.toFixed(1)}" y="${(y+dy).toFixed(1)}" text-anchor="${anchor}">${growthIcon(area)} ${escape(area)}</text>`;
      markup+=`<text class="axis-count" x="${x.toFixed(1)}" y="${(y+dy+16).toFixed(1)}" text-anchor="${anchor}">${Number(counts[area]||0)}회</text>`;
    });
    svg.innerHTML=markup;

    legend.innerHTML=GROWTH_AREA_ORDER.map(area=>`
      <div class="growth-legend-item">
        <span class="growth-legend-label"><span class="growth-legend-icon">${growthIcon(area)}</span>${escape(area)}</span>
        <span class="growth-legend-count">${Number(counts[area]||0)}회</span>
      </div>`).join("");
  }

  async function renderParentGrowthMap(){
    if(!activeChild)return;
    const {data,error}=await db.from("growth_records").select("area").eq("child_id",activeChild.id);
    if(error) throw error;
    const counts=Object.fromEntries(GROWTH_AREA_ORDER.map(a=>[a,0]));
    (data||[]).forEach(r=>{if(Object.prototype.hasOwnProperty.call(counts,r.area))counts[r.area]++;});
    const total=Object.values(counts).reduce((a,b)=>a+b,0);
    if($("parentGrowthMapTitle")) $("parentGrowthMapTitle").textContent=`🌈 ${shortName(activeChild.name)}의 전체 수업 누적 성장지도`;
    if($("parentGrowthMapTotal")) $("parentGrowthMapTotal").textContent=`${total}개 기록`;
    renderGrowthRadar(counts);
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
      .select("id,term,program,weekday,class_time,status,student_capacity,center_id,start_date,end_date,created_at,centers(name)")
      .eq("teacher_id",activeTeacherProfile.id)
      .order("created_at",{ascending:false});
    if(error) throw error;

    const classes=data||[];
    window.__prodTeacherClasses=classes;

    // 현재 달의 정규 일정이 아직 생성되지 않았다면 자동 생성합니다.
    const month=todayISO().slice(0,7);
    for(const c of classes.filter(x=>x.status!=="종료")){
      const {error:ensureErr}=await db.rpc("ensure_class_month_sessions",{p_class_id:c.id,p_month:month+"-01"});
      if(ensureErr) console.warn("teacher ensure sessions:",ensureErr.message);
    }

    let todaySessionIds=new Set();
    if(classes.length){
      const {data:sessions}=await db.from("class_sessions")
        .select("class_id")
        .in("class_id",classes.map(c=>c.id))
        .eq("session_date",todayISO())
        .eq("status","scheduled");
      todaySessionIds=new Set((sessions||[]).map(s=>s.class_id));
    }
    renderTeacherClassCards(classes,todaySessionIds);
  }

  function renderTeacherClassCards(classes,todaySessionIds=new Set()){
    const todayList=$("teacherTodayClassList");
    const otherList=$("teacherOtherClassList");
    const pastList=$("teacherPastClassList");
    if(!todayList||!otherList||!pastList) return;
    todayList.innerHTML=""; otherList.innerHTML=""; pastList.innerHTML="";

    const addCard=async(c,target,isToday,isPast=false)=>{
      const {count}=await db.from("enrollments").select("*",{count:"exact",head:true}).eq("class_id",c.id).eq("active",true);
      const total=count||0;
      let processed=0;
      if(isToday){
        const date=todayISO();
        const {data:g}=await db.from("growth_records").select("child_id").eq("class_id",c.id).eq("lesson_date",date);
        const {data:a}=await db.from("attendance").select("child_id,status").eq("class_id",c.id).eq("lesson_date",date).eq("status","absent");
        processed=new Set([...(g||[]).map(x=>x.child_id),...(a||[]).map(x=>x.child_id)]).size;
      }
      const card=document.createElement("div");
      card.className="teacher-class-card"+(isToday?" today":"")+(isPast?" past":"");
      card.innerHTML=`
        <div><b style="font-size:18px">${escape(c.centers?.name||"")} · ${escape(c.program)}</b>
        <div class="teacher-class-meta">
          <span class="badge ${isPast?"gray":""}">${escape(c.term)}</span>
          <span class="badge gray">${escape(c.weekday)}요일 ${escape(String(c.class_time).slice(0,5))}</span>
          <span class="badge gray">학생 ${total}명</span>
          ${isToday?'<span class="badge">오늘 수업</span>':""}
          ${isPast?'<span class="badge gray">종료</span>':""}
        </div></div>
        <div class="teacher-class-progress">
          <div class="muted">${
            isPast
              ? "이전 성장기록 · 사진 열람"
              : isToday
                ? `<b style="color:var(--ink)">${processed} / ${total}명</b> 오늘 기록`
                : "지난 수업 기록 · 일정 관리"
          }</div>
          <button class="btn ${isToday&&processed>=total&&total?'sec':''}" type="button">${
            isPast ? "지난 기록 보기" :
            isToday ? (processed>=total&&total?'기록 확인하기':processed?'이어서 기록하기':'오늘 기록하기') :
            '열기'
          }</button>
        </div>`;
      q("button",card).onclick=()=>openTeacherClassProd(c);
      target.appendChild(card);
    };

    const active=classes.filter(c=>c.status!=="종료");
    const past=classes.filter(c=>c.status==="종료");
    const todays=active.filter(c=>todaySessionIds.has(c.id));
    const others=active.filter(c=>!todaySessionIds.has(c.id));

    if(!todays.length) todayList.innerHTML='<div class="teacher-class-empty">오늘 예정된 수업이 없습니다. 휴강·보강 일정도 자동 반영됩니다.</div>';
    if(!others.length) otherList.innerHTML='<div class="teacher-class-empty">추가로 배정된 운영 수업이 없습니다.</div>';
    if(!past.length) pastList.innerHTML='<div class="teacher-class-empty">종료된 지난 수업이 없습니다.</div>';

    todays.forEach(c=>addCard(c,todayList,true,false));
    others.forEach(c=>addCard(c,otherList,false,false));
    past.forEach(c=>addCard(c,pastList,false,true));
  }

  window.renderTeacherClassSelection = async function(){ await loadTeacherClasses(); };

  async function openTeacherClassProd(c){
    activeClass=c;
    activeLessonDate=null;
    $("teacherClassSelectView")?.classList.add("hide");
    $("teacherClassWorkView")?.classList.remove("hide");
    if($("activeTeacherClassLabel")) $("activeTeacherClassLabel").textContent=
      `${c.centers?.name||""} · ${c.program} · ${c.weekday}요일 ${String(c.class_time).slice(0,5)}${c.status==="종료"?" · 종료된 수업":""}`;

    const defaultMonth=(c.status==="종료" && c.end_date)
      ? c.end_date.slice(0,7)
      : todayISO().slice(0,7);
    if($("teacherScheduleMonth")) $("teacherScheduleMonth").value=defaultMonth;

    if($("teacherMakeupField")) $("teacherMakeupField").classList.toggle("hide",c.status==="종료");
    if($("teacherScheduleHint")) $("teacherScheduleHint").textContent=
      c.status==="종료"
        ? "종료된 수업입니다. 지난 수업일을 선택해 성장기록과 사진을 확인할 수 있어요."
        : "지난 수업일도 선택해 성장기록을 추가·수정할 수 있어요. 휴강·보강도 담당 강사가 직접 관리할 수 있습니다.";

    await renderTeacherScheduleManagerProd(true);
    const photoTab=$("lessonTabPhotos");
    if(photoTab && typeof window.showLessonWork==="function") window.showLessonWork("photos",photoTab);
  }
  window.openTeacherClass = function(center,program,term,time,classId){
    const match=window.__prodTeacherClasses?.find?.(x=>x.id===classId);
    if(match) return openTeacherClassProd(match);
  };

  window.backToTeacherClassSelect=function(){
    activeClass=null;
    activeLessonDate=null;
    teacherSessionCache=[];
    $("teacherClassWorkView")?.classList.add("hide");
    $("teacherClassSelectView")?.classList.remove("hide");
    loadTeacherClasses();
    window.scrollTo({top:0,behavior:"smooth"});
  };


  function teacherMonthRange(month){
    const [y,m]=month.split("-").map(Number);
    const start=`${y}-${String(m).padStart(2,"0")}-01`;
    const end=`${y}-${String(m).padStart(2,"0")}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}`;
    return {start,end};
  }

  function setTeacherRecordDateUI(){
    const badge=$("activeTeacherRecordDateBadge");
    if(!activeLessonDate){
      if(badge) badge.textContent="기록할 수업일을 선택해주세요";
      $("teacherNoRecordDate")?.classList.remove("hide");
      return;
    }
    $("teacherNoRecordDate")?.classList.add("hide");
    const old=activeLessonDate!==todayISO();
    if(badge){
      badge.textContent=`${old?"지난 수업 기록":"오늘 기록"} · ${sessionDateLabel(activeLessonDate)}`;
      badge.classList.toggle("teacher-record-date-old",old);
    }
  }

  function renderTeacherSessionListProd(){
    const root=$("teacherSessionList");
    if(!root)return;
    if(!teacherSessionCache.length){
      root.innerHTML='<div class="prod-empty">이 달에 생성된 수업일정이 없습니다.</div>';
      return;
    }
    root.innerHTML="";
    teacherSessionCache.forEach(s=>{
      const row=document.createElement("div");
      row.className="teacher-session-item"+(s.status==="cancelled"?" is-cancelled":"")+(s.session_date===activeLessonDate?" is-selected":"");
      row.innerHTML=`<div class="row between" style="gap:12px;align-items:center">
        <div>
          <div class="teacher-session-date">${escape(sessionDateLabel(s.session_date))}</div>
          <div class="teacher-session-kind">${s.kind==="makeup"?"보강수업":"정규수업"} · ${s.status==="cancelled"?"휴강":"수업 예정"}${s.note?" · "+escape(s.note):""}</div>
        </div>
        <div class="teacher-session-actions">
          <span class="badge ${s.status==="cancelled"?"gray":""}">${s.status==="cancelled"?"휴강":"예정"}</span>
          ${activeClass?.status==="종료"
            ? '<span class="badge gray">열람용</span>'
            : `<button class="btn ghost small" type="button" data-action="toggle">${s.status==="cancelled"?"수업 복구":"휴강 처리"}</button>
               ${s.kind==="makeup"?'<button class="btn ghost small" type="button" data-action="delete">보강 삭제</button>':""}`
          }
        </div>
      </div>`;
      const toggle=q('[data-action="toggle"]',row);
      if(toggle) toggle.onclick=()=>window.toggleTeacherSessionStatus(s.id,s.status);
      const del=q('[data-action="delete"]',row);
      if(del)del.onclick=()=>window.deleteTeacherMakeupSession(s.id);
      root.appendChild(row);
    });
  }

  function populateTeacherRecordDateSelect(preferDate=null){
    const select=$("teacherLessonDateSelect");
    if(!select)return null;
    const eligible=teacherSessionCache
      .filter(s=>s.status==="scheduled" && s.session_date<=todayISO())
      .sort((a,b)=>b.session_date.localeCompare(a.session_date));
    select.innerHTML="";
    if(!eligible.length){
      select.add(new Option("기록 가능한 지난 수업일이 없습니다.",""));
      select.disabled=true;
      return null;
    }
    select.disabled=false;
    eligible.forEach(s=>{
      const label=`${sessionDateLabel(s.session_date)} · ${s.kind==="makeup"?"보강":"정규"}`;
      select.add(new Option(label,s.session_date));
    });
    const wanted=preferDate && eligible.some(s=>s.session_date===preferDate)
      ? preferDate
      : (eligible.some(s=>s.session_date===todayISO()) ? todayISO() : eligible[0].session_date);
    select.value=wanted;
    return wanted;
  }

  async function renderTeacherScheduleManagerProd(initial=false){
    if(!activeClass)return;
    const month=$("teacherScheduleMonth")?.value || todayISO().slice(0,7);
    if($("teacherScheduleMonth") && !$("teacherScheduleMonth").value) $("teacherScheduleMonth").value=month;
    const {start,end}=teacherMonthRange(month);

    const {error:ensureErr}=await db.rpc("ensure_class_month_sessions",{p_class_id:activeClass.id,p_month:start});
    if(ensureErr){
      notify("수업일정 생성 실패: "+ensureErr.message);
      return;
    }

    const {data,error}=await db.from("class_sessions")
      .select("id,class_id,session_date,kind,status,note")
      .eq("class_id",activeClass.id)
      .gte("session_date",start).lte("session_date",end)
      .order("session_date");
    if(error){
      notify("수업일정 불러오기 실패: "+error.message);
      return;
    }
    teacherSessionCache=data||[];

    const makeup=$("teacherMakeupDate");
    if(makeup && (!makeup.value || makeup.value.slice(0,7)!==month)) makeup.value=start;

    const chosen=populateTeacherRecordDateSelect(initial?todayISO():activeLessonDate);
    const changed=chosen!==activeLessonDate;
    activeLessonDate=chosen;
    setTeacherRecordDateUI();
    renderTeacherSessionListProd();

    if(initial || changed){
      await loadTeacherStudentsForClass();
      await loadTeacherPhotos();
    }
  }
  window.renderTeacherScheduleManager=()=>renderTeacherScheduleManagerProd(false);

  window.changeTeacherLessonDate=async function(date){
    if(!date)return;
    const row=teacherSessionCache.find(s=>s.session_date===date);
    if(!row || row.status!=="scheduled" || date>todayISO()) return notify("기록 가능한 수업일을 선택해주세요.");
    activeLessonDate=date;
    setTeacherRecordDateUI();
    renderTeacherSessionListProd();
    await loadTeacherStudentsForClass();
    await loadTeacherPhotos();
    const photoTab=$("lessonTabPhotos");
    if(photoTab && typeof window.showLessonWork==="function") window.showLessonWork("photos",photoTab);
  };

  window.toggleTeacherSessionStatus=async function(id,current){
    if(activeClass?.status==="종료") return notify("종료된 수업은 일정 변경을 할 수 없습니다.");
    if(!activeClass)return;
    const next=current==="cancelled"?"scheduled":"cancelled";
    const {error}=await db.from("class_sessions").update({status:next}).eq("id",id).eq("class_id",activeClass.id);
    if(error)return notify("일정 변경 실패: "+error.message);
    notify(next==="cancelled"?"휴강으로 반영했습니다.":"수업 일정으로 복구했습니다.");
    await renderTeacherScheduleManagerProd(false);
  };

  window.deleteTeacherMakeupSession=async function(id){
    if(activeClass?.status==="종료") return notify("종료된 수업은 일정 변경을 할 수 없습니다.");
    if(!activeClass || !confirm("이 보강 일정을 삭제할까요?"))return;
    const {error}=await db.from("class_sessions").delete().eq("id",id).eq("class_id",activeClass.id).eq("kind","makeup");
    if(error)return notify("보강 삭제 실패: "+error.message);
    notify("보강 일정을 삭제했습니다.");
    await renderTeacherScheduleManagerProd(false);
  };

  window.addTeacherMakeupSession=async function(){
    if(activeClass?.status==="종료") return notify("종료된 수업은 보강을 추가할 수 없습니다.");
    if(!activeClass)return;
    const date=$("teacherMakeupDate")?.value;
    const month=$("teacherScheduleMonth")?.value;
    if(!date)return notify("보강 날짜를 선택해주세요.");
    if(month && date.slice(0,7)!==month)return notify("현재 확인 중인 월 안에서 보강 날짜를 선택해주세요.");

    const {data:existing,error:findErr}=await db.from("class_sessions")
      .select("id,kind,status")
      .eq("class_id",activeClass.id).eq("session_date",date).maybeSingle();
    if(findErr)return notify("일정 확인 실패: "+findErr.message);
    if(existing){
      if(existing.status==="cancelled"){
        const {error}=await db.from("class_sessions").update({status:"scheduled",kind:existing.kind||"makeup"}).eq("id",existing.id);
        if(error)return notify("일정 복구 실패: "+error.message);
        notify("해당 날짜의 수업일정을 복구했습니다.");
        return renderTeacherScheduleManagerProd(false);
      }
      return notify("이미 해당 날짜에 수업 일정이 있습니다.");
    }

    const {error}=await db.from("class_sessions").insert({
      class_id:activeClass.id,session_date:date,kind:"makeup",status:"scheduled",note:"강사 등록 보강"
    });
    if(error)return notify("보강 추가 실패: "+error.message);
    notify("보강 일정을 추가했습니다.");
    await renderTeacherScheduleManagerProd(false);
  };

  async function loadTeacherStudentsForClass(){
    if(!activeClass || !activeLessonDate){
      const tabs=$("lessonStudentTabs");
      if(tabs) tabs.innerHTML='<button id="lessonTabPhotos" class="on" type="button">전체 사진</button>';
      teacherStudents.splice(0,teacherStudents.length);
      Object.keys(studentRecordState).forEach(k=>delete studentRecordState[k]);
      window.updateLessonProgress?.();
      return;
    }
    const {data,error}=await db.from("enrollments")
      .select("child_id,children(id,name,birth_date)")
      .eq("class_id",activeClass.id).eq("active",true);
    if(error) throw error;
    const children=(data||[]).map(x=>x.children).filter(Boolean);
    teacherStudents.splice(0,teacherStudents.length,...children.map(c=>c.name));
    Object.keys(studentRecordState).forEach(k=>delete studentRecordState[k]);

    const date=activeLessonDate;
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
    if(!activeClass || !activeLessonDate) return;
    const {data,error}=await db.from("photos").select("*").eq("class_id",activeClass.id).eq("lesson_date",activeLessonDate).order("created_at");
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
      if(activeClass?.status!=="종료") div.onclick=async()=>{
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
      if(activeClass?.status==="종료") return notify("종료된 수업은 이전 기록 열람만 가능합니다.");
      if(!files.length||!activeClass||!activeLessonDate) return notify("먼저 기록할 수업일을 선택해주세요.");
      try{
        for(const file of files){
          const safe=file.name.replace(/[^0-9A-Za-z가-힣._-]/g,"_");
          const path=`${activeClass.id}/${activeLessonDate}/${crypto.randomUUID()}-${safe}`;
          const {error:upErr}=await db.storage.from("activity-photos").upload(path,file,{upsert:false});
          if(upErr) throw upErr;
          const {error:dbErr}=await db.from("photos").insert({
            class_id:activeClass.id,lesson_date:activeLessonDate,storage_path:path,uploaded_by:session.user.id
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
    if(activeClass?.status==="종료") return notify("종료된 수업은 이전 기록 열람만 가능합니다.");
    if(!st||!activeClass||!activeLessonDate) return notify("먼저 기록할 수업일을 선택해주세요.");
    if(st.absent) return notify("결석 처리된 아이는 성장기록을 저장하지 않습니다.");
    try{
      const behavior=$("behavior")?.value||st.behavior;
      const mi=Number($("mission")?.value||0);
      const m=missionData[behavior]?.[mi];
      const payload={
        class_id:activeClass.id,child_id:st.childId,lesson_date:activeLessonDate,
        teacher_id:activeTeacherProfile.id,area:selectedGrowthArea,
        behavior,mission:m?.q||"",expansion_questions:m?.ex||[],
        observation_text:getParentGrowthDescription(behavior)
      };
      const {error}=await db.from("growth_records").upsert(payload,{onConflict:"class_id,child_id,lesson_date"});
      if(error) throw error;
      await db.from("attendance").upsert({class_id:activeClass.id,child_id:st.childId,lesson_date:activeLessonDate,status:"present"},{onConflict:"class_id,child_id,lesson_date"});
      st.complete=true;st.dirty=false;st.absent=false;
      window.updateStudentEditUI?.(currentTeacherStudent);
      window.updateLessonProgress?.();
      notify(currentTeacherStudent+" 기록을 저장했습니다.");
    }catch(e){notify("기록 저장 실패: "+e.message);}
  };

  window.toggleCurrentStudentAbsent=async function(){
    const st=studentRecordState[currentTeacherStudent];
    if(activeClass?.status==="종료") return notify("종료된 수업은 이전 기록 열람만 가능합니다.");
    if(!st||!activeClass||!activeLessonDate) return notify("먼저 기록할 수업일을 선택해주세요.");
    try{
      const next=!st.absent;
      if(next){
        const {error}=await db.from("attendance").upsert({class_id:activeClass.id,child_id:st.childId,lesson_date:activeLessonDate,status:"absent"},{onConflict:"class_id,child_id,lesson_date"});
        if(error) throw error;
        await db.from("growth_records").delete().eq("class_id",activeClass.id).eq("child_id",st.childId).eq("lesson_date",activeLessonDate);
        if(prodPhotos.length){
          await db.from("photo_assignments").delete().eq("child_id",st.childId).in("photo_id",prodPhotos.map(p=>p.id));
        }
        st.absent=true;st.complete=true;st.dirty=false;st.photos.clear();
      }else{
        await db.from("attendance").upsert({class_id:activeClass.id,child_id:st.childId,lesson_date:activeLessonDate,status:"present"},{onConflict:"class_id,child_id,lesson_date"});
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
        <p>${escape(x.content)}</p>
        <div class="row" style="margin-top:12px;gap:7px;flex-wrap:wrap">
          <button class="btn small ghost" data-action="read">${x.status==="read"?"다시 미확인":"읽음 처리"}</button>
          ${x.status==="read"?'<button class="btn small danger" data-action="delete">삭제</button>':""}
        </div>`;
      q('[data-action="read"]',card).onclick=async()=>{
        const next=x.status==="read"?"unread":"read";
        const {error}=await db.from("inquiries").update({status:next}).eq("id",x.id);
        if(error)return notify(error.message);
        await loadTeacherInquiries();
      };
      const del=q('[data-action="delete"]',card);
      if(del)del.onclick=async()=>{
        if(!confirm("확인한 문의를 삭제할까요? 삭제 후에는 되돌릴 수 없습니다."))return;
        const {error}=await db.from("inquiries").delete().eq("id",x.id);
        if(error)return notify("문의 삭제 실패: "+error.message);
        notify("문의를 삭제했습니다.");
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
      loadAdminChildClassOptions(),
      renderAdminMembers(),
      renderAdminFees(),
      renderAdminInquiries(),
      renderAdminTodayTomorrow(),
      renderAdminMonthlyProd()
    ]);
    await renderAdminTopStats();
  }

  async function renderAdminTopStats(){
    const {data:classes,error:cErr}=await db.from("classes").select("id").eq("status","운영중");
    if(cErr) throw cErr;
    const currentMonth=todayISO().slice(0,7)+"-01";
    for(const c of classes||[]){
      const {error}=await db.rpc("ensure_class_month_sessions",{p_class_id:c.id,p_month:currentMonth});
      if(error) console.warn(error.message);
    }
    const {data:sessions,error:sErr}=await db.from("class_sessions")
      .select("class_id").eq("session_date",todayISO()).eq("status","scheduled");
    if(sErr) throw sErr;
    const ids=[...new Set((sessions||[]).map(s=>s.class_id))];

    let completedClasses=0;
    for(const id of ids){
      const total=(await db.from("enrollments").select("*",{count:"exact",head:true}).eq("class_id",id).eq("active",true)).count||0;
      if(!total) continue;
      const gr=(await db.from("growth_records").select("child_id").eq("class_id",id).eq("lesson_date",todayISO())).data||[];
      const ab=(await db.from("attendance").select("child_id").eq("class_id",id).eq("lesson_date",todayISO()).eq("status","absent")).data||[];
      if(new Set([...gr.map(x=>x.child_id),...ab.map(x=>x.child_id)]).size>=total) completedClasses++;
    }
    const totalToday=ids.length;
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

  async function loadAdminChildClassOptions(){
    const childSel=$("adminAddChildSelect");
    const classSel=$("adminAddClassSelect");
    if(!childSel||!classSel)return;

    const childRes=await db.from("children").select("id,name,birth_date").order("name");
    const classRes=await db.from("classes")
      .select("id,term,program,weekday,class_time,status,centers(name)")
      .in("status",["운영중","예정"])
      .order("created_at",{ascending:false});

    if(childRes.error){ console.warn(childRes.error); return; }
    if(classRes.error){ console.warn(classRes.error); return; }

    adminChildClassChildren=childRes.data||[];
    adminChildClassClasses=classRes.data||[];

    const oldChild=childSel.value,oldClass=classSel.value;
    childSel.innerHTML='<option value="">아이 선택</option>';
    adminChildClassChildren.forEach(ch=>{
      const birth=ch.birth_date?` · ${ch.birth_date}`:"";
      childSel.add(new Option(`${ch.name}${birth}`,ch.id));
    });

    classSel.innerHTML='<option value="">수업 선택</option>';
    adminChildClassClasses.forEach(c=>{
      classSel.add(new Option(
        `${c.centers?.name||""} · ${c.term||""} · ${c.program||""} · ${c.weekday||""} ${String(c.class_time||"").slice(0,5)} · ${c.status}`,
        c.id
      ));
    });

    if(oldChild && adminChildClassChildren.some(x=>x.id===oldChild)) childSel.value=oldChild;
    if(oldClass && adminChildClassClasses.some(x=>x.id===oldClass)) classSel.value=oldClass;
    await window.previewAdminAddClass();
  }

  window.previewAdminAddClass=async function(){
    const box=$("adminAddClassPreview"),btn=$("adminAddClassButton");
    if(!box)return;
    const childId=$("adminAddChildSelect")?.value||"";
    const classId=$("adminAddClassSelect")?.value||"";
    if(btn)btn.disabled=!childId||!classId;

    if(!childId||!classId){
      box.textContent="아이와 수업을 선택해주세요.";
      return;
    }

    const child=adminChildClassChildren.find(x=>x.id===childId);
    const cls=adminChildClassClasses.find(x=>x.id===classId);
    const {data:existing,error}=await db.from("enrollments")
      .select("id,active").eq("child_id",childId).eq("class_id",classId).maybeSingle();
    if(error){
      box.textContent="현재 연결상태를 확인하지 못했습니다.";
      return;
    }

    if(existing?.active){
      box.innerHTML=`<b>${escape(child?.name||"")}</b>은(는) 이미 <b>${escape(cls?.program||"")}</b> 수업에 연결되어 있습니다.`;
      if(btn)btn.disabled=true;
      return;
    }

    box.innerHTML=`<b>${escape(child?.name||"")}</b>에게
      <b>${escape(cls?.centers?.name||"")} · ${escape(cls?.term||"")} · ${escape(cls?.program||"")}</b> 수업을 추가합니다.<br>
      추가 즉시 학부모 계정과 해당 반 담당 강사 학생목록에 연결됩니다.`;
  };

  window.adminAddClassToChild=async function(){
    const childId=$("adminAddChildSelect")?.value||"";
    const classId=$("adminAddClassSelect")?.value||"";
    if(!childId||!classId)return notify("아이와 수업을 모두 선택해주세요.");

    const child=adminChildClassChildren.find(x=>x.id===childId);
    const cls=adminChildClassClasses.find(x=>x.id===classId);
    if(!confirm(`${child?.name||"아이"}에게\n${cls?.centers?.name||""} · ${cls?.term||""} · ${cls?.program||""}\n수업을 추가할까요?`))return;

    const btn=$("adminAddClassButton");
    if(btn){btn.disabled=true;btn.textContent="추가 중...";}
    try{
      const {error}=await db.rpc("admin_add_class_to_child",{
        p_child_id:childId,
        p_class_id:classId
      });
      if(error)throw error;
      notify("수업을 추가했습니다. 학부모와 담당 강사에게 바로 연결됩니다.");
      await loadAdminChildClassOptions();
    }catch(e){
      notify("수업 추가 실패: "+(e?.message||e));
    }finally{
      if(btn){btn.textContent="수업 추가";}
      await window.previewAdminAddClass();
    }
  };

  async function renderAdminClasses(){
    const body=$("adminClassBody");if(!body)return;
    const {data,error}=await db.from("classes")
      .select("id,term,program,weekday,class_time,start_date,end_date,teacher_id,student_capacity,status,class_amount,join_code,centers(id,name),profiles!classes_teacher_id_fkey(id,name)")
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
    $("editClassStartDate").value=c.start_date||"";
    $("editClassEndDate").value=c.end_date||"";
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
        ...time,start_date:$("newClassStartDate").value||null,end_date:$("newClassEndDate").value||null,
        teacher_id:teacher.id,student_capacity:Number($("newClassStudents").value||0),
        class_amount:Number(String($("newClassAmount").value||"").replace(/\D/g,"")||0),
        status:$("newClassStatus").value
      };
      if(!payload.term) return notify("학기를 입력해주세요.");
      if(!payload.start_date || !payload.end_date) return notify("수업 시작일과 종료일을 입력해주세요.");
      if(payload.end_date < payload.start_date) return notify("수업 종료일은 시작일보다 빠를 수 없습니다.");
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
        ...time,start_date:$("editClassStartDate").value||null,end_date:$("editClassEndDate").value||null,
        teacher_id:teacher.id,student_capacity:Number($("editClassStudents").value||0),
        class_amount:Number(String($("editClassAmount").value||"").replace(/\D/g,"")||0),
        status:$("editClassStatus").value
      };
      if(!payload.start_date || !payload.end_date) return notify("수업 시작일과 종료일을 입력해주세요.");
      if(payload.end_date < payload.start_date) return notify("수업 종료일은 시작일보다 빠를 수 없습니다.");
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

  function setFilterOptions(selectId,values,allLabel){
    const select=$(selectId);
    if(!select)return;
    const current=select.value;
    const unique=[...new Set((values||[]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"));
    select.innerHTML="";
    select.add(new Option(allLabel,""));
    unique.forEach(value=>select.add(new Option(value,value)));
    if(current && unique.includes(current)) select.value=current;
  }

  function syncProgramFilterFromTable(tableId,centerSelectId,programSelectId){
    const table=$(tableId),centerSelect=$(centerSelectId),programSelect=$(programSelectId);
    if(!table||!centerSelect||!programSelect)return;
    const center=centerSelect.value;
    const programs=qAll("tbody tr[data-center][data-program]",table)
      .filter(tr=>!center || tr.dataset.center===center)
      .map(tr=>tr.dataset.program);
    setFilterOptions(programSelectId,programs,"전체 프로그램");
  }

  function filterRowsByCenterProgram(tableId,centerSelectId,programSelectId){
    const table=$(tableId),centerSelect=$(centerSelectId),programSelect=$(programSelectId);
    if(!table||!centerSelect||!programSelect)return;

    const center=centerSelect.value;
    syncProgramFilterFromTable(tableId,centerSelectId,programSelectId);
    const program=programSelect.value;

    qAll("tbody tr[data-center][data-program]",table).forEach(tr=>{
      const centerOk=!center || tr.dataset.center===center;
      const programOk=!program || tr.dataset.program===program;
      tr.classList.toggle("hide",!(centerOk && programOk));
    });
  }

  window.filterAdminParentMembers=()=>filterRowsByCenterProgram(
    "parentMemberTable","adminParentCenterFilter","adminParentProgramFilter"
  );
  window.filterAdminFees=()=>filterRowsByCenterProgram(
    "adminFeeTable","adminFeeCenterFilter","adminFeeProgramFilter"
  );
  window.filterAdminInquiries=()=>filterRowsByCenterProgram(
    "adminInquiryTable","adminInquiryCenterFilter","adminInquiryProgramFilter"
  );

  async function renderAdminMembers(){
    const {data:profiles,error}=await db.from("profiles")
      .select("id,role,name,phone,active")
      .in("role",["parent","teacher"])
      .order("name");
    if(error) throw error;

    const parents=(profiles||[]).filter(p=>p.role==="parent");
    const teachers=(profiles||[]).filter(p=>p.role==="teacher");

    const [{data:children,error:childErr},{data:enrs,error:enrErr}]=await Promise.all([
      db.from("children").select("id,name,birth_date,parent_id"),
      db.from("enrollments").select("child_id,class_id,active,classes(term,program,status,centers(name))")
    ]);
    if(childErr) throw childErr;
    if(enrErr) throw enrErr;

    const childById=new Map((children||[]).map(c=>[c.id,c]));
    const parentGroups=new Map();

    for(const enr of enrs||[]){
      const child=childById.get(enr.child_id);
      if(!child)continue;

      const center=enr.classes?.centers?.name||"미연결";
      const program=enr.classes?.program||"미연결";
      const key=`${center}|||${program}`;

      if(!parentGroups.has(child.parent_id)) parentGroups.set(child.parent_id,new Map());
      const groupMap=parentGroups.get(child.parent_id);
      if(!groupMap.has(key)) groupMap.set(key,{center,program,details:[]});

      const status=enr.classes?.status==="종료"?" · 종료":"";
      groupMap.get(key).details.push(`${child.name} · ${enr.classes?.term||""}${status}`);
    }

    const pb=$("parentMemberBody"),tb=$("teacherMemberBody");
    if(pb)pb.innerHTML="";
    if(tb)tb.innerHTML="";

    const parentRows=[];
    parents.forEach(p=>{
      const groupMap=parentGroups.get(p.id);
      if(groupMap?.size){
        [...groupMap.values()].forEach(group=>{
          parentRows.push({
            p,
            center:group.center,
            program:group.program,
            detail:[...new Set(group.details)].join(" / ")
          });
        });
      }else{
        const ownChildren=(children||[]).filter(c=>c.parent_id===p.id).map(c=>c.name);
        parentRows.push({
          p,center:"미연결",program:"미연결",
          detail:ownChildren.length?ownChildren.join(", "):"연결된 아이 없음"
        });
      }
    });

    parentRows.sort((a,b)=>
      a.center.localeCompare(b.center,"ko") ||
      a.program.localeCompare(b.program,"ko") ||
      String(a.p.name||"").localeCompare(String(b.p.name||""),"ko")
    );

    let rowSeq=0;
    parentRows.forEach(({p,center,program,detail})=>{
      const tr=document.createElement("tr");
      tr.dataset.center=center;
      tr.dataset.program=program;
      const switchId=`parent-active-${p.id}-${rowSeq++}`;
      tr.innerHTML=`<td>${escape(p.name||"")}</td><td>${escape(center)}</td><td>${escape(program)}</td><td>${escape(detail)}</td>
        <td><span class="badge ${p.active?"":"gray"}">${p.active?"활성":"비활성"}</span></td>
        <td><input class="switch" id="${switchId}" type="checkbox" ${p.active?"checked":""}><label for="${switchId}" class="toggle"></label></td>
        <td><button class="btn ghost small" type="button">비밀번호 초기화</button></td>`;
      q("input",tr).onchange=async e=>{
        const next=e.target.checked;
        const {error}=await db.from("profiles").update({active:next}).eq("id",p.id);
        if(error){notify(error.message);return renderAdminMembers();}
        notify(next?"로그인을 허용했습니다.":"로그인을 비활성화했습니다.");
        await renderAdminMembers();
      };
      q("button",tr).onclick=()=>notify("운영 초기에는 Supabase 관리자 또는 제공된 Edge Function으로 비밀번호를 초기화해주세요.");
      pb?.appendChild(tr);
    });

    teachers.forEach(p=>{
      const tr=document.createElement("tr");
      const switchId=`teacher-active-${p.id}`;
      tr.innerHTML=`<td>${escape(p.name||"")}</td><td>강사 계정</td><td><span class="badge ${p.active?"":"gray"}">${p.active?"활성":"비활성"}</span></td>
        <td><input class="switch" id="${switchId}" type="checkbox" ${p.active?"checked":""}><label for="${switchId}" class="toggle"></label></td>
        <td><button class="btn ghost small" type="button">비밀번호 초기화</button></td>`;
      q("input",tr).onchange=async e=>{
        const next=e.target.checked;
        const {error}=await db.from("profiles").update({active:next}).eq("id",p.id);
        if(error){notify(error.message);return renderAdminMembers();}
        notify(next?"로그인을 허용했습니다.":"로그인을 비활성화했습니다.");
        await renderAdminMembers();
      };
      q("button",tr).onclick=()=>notify("운영 초기에는 Supabase 관리자 또는 제공된 Edge Function으로 비밀번호를 초기화해주세요.");
      tb?.appendChild(tr);
    });

    setFilterOptions("adminParentCenterFilter",parentRows.map(x=>x.center),"전체 센터");
    syncProgramFilterFromTable("parentMemberTable","adminParentCenterFilter","adminParentProgramFilter");
    window.filterAdminParentMembers();
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

    const rows=(data||[]).map(f=>({
      ...f,
      center:f.classes?.centers?.name||"미지정"
    })).sort((a,b)=>
      a.center.localeCompare(b.center,"ko") ||
      String(a.program||"").localeCompare(String(b.program||""),"ko") ||
      String(a.children?.name||"").localeCompare(String(b.children?.name||""),"ko")
    );

    body.innerHTML="";
    rows.forEach(f=>{
      const tr=document.createElement("tr");
      tr.dataset.center=f.center;
      tr.dataset.program=f.program||"미지정";
      tr.innerHTML=`<td>${escape(f.children?.name||"")}</td><td>${escape(f.center)}</td><td>${escape(f.program)}</td><td>${escape(f.item)}</td>
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
        f.paid=!f.paid;
        await db.from("fees").update({paid:f.paid}).eq("id",f.id);
        e.target.textContent=f.paid?"완료":"입금확인";
        e.target.classList.toggle("ghost",f.paid);
      };
      body.appendChild(tr);
    });

    setFilterOptions("adminFeeCenterFilter",rows.map(x=>x.center),"전체 센터");
    syncProgramFilterFromTable("adminFeeTable","adminFeeCenterFilter","adminFeeProgramFilter");
    window.filterAdminFees();
    prepareResponsiveTables();
  }

  async function renderAdminInquiries(){
    const body=$("adminInquiryBody");if(!body)return;
    const {data,error}=await db.from("inquiries")
      .select("id,type,target,content,status,created_at,class_id,children(name),classes(program,centers(name)),profiles!inquiries_assigned_teacher_id_fkey(name)")
      .order("created_at",{ascending:false});
    if(error) throw error;

    const rows=(data||[]).map(x=>({
      ...x,
      center:x.classes?.centers?.name||"미지정",
      program:x.classes?.program||"미지정"
    })).sort((a,b)=>
      a.center.localeCompare(b.center,"ko") ||
      a.program.localeCompare(b.program,"ko") ||
      String(b.created_at||"").localeCompare(String(a.created_at||""))
    );

    body.innerHTML="";
    rows.forEach(x=>{
      const tr=document.createElement("tr");
      tr.dataset.center=x.center;
      tr.dataset.program=x.program;
      tr.innerHTML=`<td>${escape(x.center)}</td><td>${escape(x.program)}</td><td>${escape(x.children?.name||"")}</td><td>${escape(x.type)}</td><td>${x.target==="teacher"?"담당 강사":"회사"}</td>
        <td>${escape(x.content)}</td><td>${escape(x.target==="teacher"?(x.profiles?.name||""):"관리자")}</td><td></td><td></td>`;
      const statusTd=tr.children[7],manageTd=tr.children[8];

      if(x.target==="company"){
        const b=document.createElement("button");
        b.className="btn small "+(x.status==="read"?"ghost":"danger");
        b.textContent=x.status==="read"?"확인함":"확인 전";
        b.onclick=async()=>{
          const next=x.status==="read"?"unread":"read";
          const {error}=await db.from("inquiries").update({status:next}).eq("id",x.id);
          if(error)return notify("문의 상태 변경 실패: "+error.message);
          await renderAdminInquiries();
        };
        statusTd.appendChild(b);
      }else{
        statusTd.innerHTML=`<span class="badge ${x.status==="read"?"gray":"warn"}">${x.status==="read"?"확인함":"확인 전"}</span>`;
      }

      if(x.status==="read"){
        const del=document.createElement("button");
        del.className="btn small danger";
        del.textContent="삭제";
        del.onclick=async()=>{
          if(!confirm("확인한 문의를 삭제할까요? 삭제 후에는 되돌릴 수 없습니다."))return;
          const {error}=await db.from("inquiries").delete().eq("id",x.id);
          if(error)return notify("문의 삭제 실패: "+error.message);
          notify("문의를 삭제했습니다.");
          await renderAdminInquiries();
        };
        manageTd.appendChild(del);
      }else{
        manageTd.innerHTML='<span class="muted">확인 후 삭제</span>';
      }
      body.appendChild(tr);
    });

    setFilterOptions("adminInquiryCenterFilter",rows.map(x=>x.center),"전체 센터");
    syncProgramFilterFromTable("adminInquiryTable","adminInquiryCenterFilter","adminInquiryProgramFilter");
    window.filterAdminInquiries();
    prepareResponsiveTables();
  }

  async function renderAdminTodayTomorrow(){
    const all=await db.from("classes").select("id,term,program,weekday,class_time,status,teacher_id,centers(name),profiles!classes_teacher_id_fkey(name)").eq("status","운영중");
    if(all.error) throw all.error;

    const now=new Date(), tomorrow=new Date(now);tomorrow.setDate(now.getDate()+1);
    const z=n=>String(n).padStart(2,"0");
    const tomorrowISO=`${tomorrow.getFullYear()}-${z(tomorrow.getMonth()+1)}-${z(tomorrow.getDate())}`;

    // 오늘/내일이 다른 달에 걸쳐도 각 달의 일정을 먼저 생성합니다.
    const months=[...new Set([todayISO().slice(0,7)+"-01",tomorrowISO.slice(0,7)+"-01"])];
    for(const c of all.data||[]){
      for(const month of months){
        const {error}=await db.rpc("ensure_class_month_sessions",{p_class_id:c.id,p_month:month});
        if(error) console.warn(error.message);
      }
    }

    const {data:sessions,error:sErr}=await db.from("class_sessions")
      .select("class_id,session_date,status")
      .in("session_date",[todayISO(),tomorrowISO])
      .eq("status","scheduled");
    if(sErr) throw sErr;
    const todayIds=new Set((sessions||[]).filter(s=>s.session_date===todayISO()).map(s=>s.class_id));
    const tomorrowIds=new Set((sessions||[]).filter(s=>s.session_date===tomorrowISO).map(s=>s.class_id));

    const td=$("adminTodayClassBody"),tm=$("adminTomorrowClassBody");
    if(td)td.innerHTML="";if(tm)tm.innerHTML="";
    adminTodayDetailClassId=null;
    const todayDetail=$("adminTodayClassDetail");
    if(todayDetail){todayDetail.classList.add("hide");todayDetail.innerHTML="";}

    for(const c of all.data||[]){
      if(todayIds.has(c.id) && td){
        const total=(await db.from("enrollments").select("*",{count:"exact",head:true}).eq("class_id",c.id).eq("active",true)).count||0;
        const g=(await db.from("growth_records").select("child_id").eq("class_id",c.id).eq("lesson_date",todayISO())).data||[];
        const a=(await db.from("attendance").select("child_id,status").eq("class_id",c.id).eq("lesson_date",todayISO()).eq("status","absent")).data||[];
        const done=new Set([...g.map(x=>x.child_id),...a.map(x=>x.child_id)]).size;
        const tr=document.createElement("tr");
        tr.innerHTML=`<td>${escape(c.centers?.name||"")}</td><td>${escape(c.term)}</td><td>${escape(c.program)}</td><td>${String(c.class_time).slice(0,5)}</td><td>${escape(c.profiles?.name||"")}</td><td><b>${done>=total&&total?"전원완료":`${done} / ${total}명`}</b></td>`;
        tr.onclick=()=>toggleTodayDetailProd(c,total,g,a,tr);
        td.appendChild(tr);
      }
      if(tomorrowIds.has(c.id) && tm){
        const count=(await db.from("enrollments").select("*",{count:"exact",head:true}).eq("class_id",c.id).eq("active",true)).count||0;
        const tr=document.createElement("tr");
        tr.innerHTML=`<td>${escape(c.centers?.name||"")}</td><td>${escape(c.term)}</td><td>${escape(c.program)}</td><td>${String(c.class_time).slice(0,5)}</td><td>${escape(c.profiles?.name||"")}</td><td>${count}명</td>`;
        tm.appendChild(tr);
      }
    }
    if(td && !td.children.length) td.innerHTML='<tr><td colspan="6" class="muted">오늘 예정된 실제 수업이 없습니다.</td></tr>';
    if(tm && !tm.children.length) tm.innerHTML='<tr><td colspan="6" class="muted">내일 예정된 실제 수업이 없습니다.</td></tr>';
    prepareResponsiveTables();
  }

  async function toggleTodayDetailProd(c,total,g,a,tr){
    const detail=$("adminTodayClassDetail");if(!detail)return;

    if(adminTodayDetailClassId===c.id && !detail.classList.contains("hide")){
      adminTodayDetailClassId=null;
      detail.classList.add("hide");
      detail.innerHTML="";
      qAll("#adminTodayClassBody tr").forEach(row=>row.classList.remove("is-open"));
      return;
    }

    adminTodayDetailClassId=c.id;
    qAll("#adminTodayClassBody tr").forEach(row=>row.classList.remove("is-open"));
    tr?.classList.add("is-open");
    await renderTodayDetailProd(c,total,g,a);
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

  function monthDateRange(month){
    const [y,m]=month.split("-").map(Number);
    const start=`${y}-${String(m).padStart(2,"0")}-01`;
    const last=new Date(y,m,0).getDate();
    const end=`${y}-${String(m).padStart(2,"0")}-${String(last).padStart(2,"0")}`;
    return {start,end};
  }

  function sessionDateLabel(ds){
    const d=new Date(ds+"T00:00:00");
    return `${d.getMonth()+1}월 ${d.getDate()}일 ${weekdayChar(d)}요일`;
  }

  let adminMonthlyClassesCache=[];
  let adminMonthlySessionsCache=[];

  async function ensureAdminMonthSessions(classes,month){
    const first=month+"-01";
    for(const c of classes||[]){
      const {error}=await db.rpc("ensure_class_month_sessions",{p_class_id:c.id,p_month:first});
      if(error) throw error;
    }
  }

  function renderAdminSessionListProd(){
    const select=$("adminScheduleClass"),root=$("adminSessionList");
    if(!select||!root)return;
    const classId=select.value;
    const c=adminMonthlyClassesCache.find(x=>x.id===classId);
    if(!c){root.innerHTML='<div class="prod-empty">반을 선택해주세요.</div>';return;}
    const rows=adminMonthlySessionsCache
      .filter(x=>x.class_id===classId)
      .sort((a,b)=>a.session_date.localeCompare(b.session_date));
    if(!rows.length){
      root.innerHTML='<div class="prod-empty">이 달에는 예정된 수업이 없습니다. 반의 시작일·종료일과 요일을 확인해주세요.</div>';
      return;
    }
    root.innerHTML="";
    rows.forEach(s=>{
      const row=document.createElement("div");
      row.className="record";
      row.style.marginTop="8px";
      row.innerHTML=`<div class="row between" style="gap:12px;align-items:center">
        <div><b>${escape(sessionDateLabel(s.session_date))}</b>
          <div class="muted" style="margin-top:4px">${s.kind==="makeup"?"보강수업":"정규수업"} · ${s.status==="cancelled"?"휴강":"수업 예정"}${s.note?" · "+escape(s.note):""}</div></div>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <span class="badge ${s.status==="cancelled"?"gray":""}">${s.status==="cancelled"?"휴강":"예정"}</span>
          <button class="btn ghost small" type="button" data-action="toggle">${s.status==="cancelled"?"수업 복구":"휴강 처리"}</button>
          ${s.kind==="makeup"?'<button class="btn ghost small" type="button" data-action="delete">보강 삭제</button>':""}
        </div></div>`;
      q('[data-action="toggle"]',row).onclick=()=>window.toggleAdminSessionStatus(s.id,s.status);
      const del=q('[data-action="delete"]',row);if(del)del.onclick=()=>window.deleteAdminMakeupSession(s.id);
      root.appendChild(row);
    });
  }
  window.renderAdminSessionList=renderAdminSessionListProd;

  async function renderAdminScheduleManager(classes,sessions,month){
    adminMonthlyClassesCache=classes||[];
    adminMonthlySessionsCache=sessions||[];
    const select=$("adminScheduleClass");if(!select)return;
    const prev=select.value;
    select.innerHTML="";
    (classes||[]).forEach(c=>{
      const o=document.createElement("option");o.value=c.id;
      o.textContent=`${c.centers?.name||""} · ${c.program} · ${c.weekday} ${String(c.class_time).slice(0,5)}`;
      select.appendChild(o);
    });
    if(prev && (classes||[]).some(c=>c.id===prev)) select.value=prev;
    const makeup=$("adminMakeupDate");if(makeup){
      const {start}=monthDateRange(month);
      if(!makeup.value || makeup.value.slice(0,7)!==month) makeup.value=start;
    }
    renderAdminSessionListProd();
  }

  window.toggleAdminSessionStatus=async function(id,current){
    const next=current==="cancelled"?"scheduled":"cancelled";
    const {error}=await db.from("class_sessions").update({status:next}).eq("id",id);
    if(error)return notify("일정 변경 실패: "+error.message);
    notify(next==="cancelled"?"휴강으로 반영했습니다.":"수업 일정으로 복구했습니다.");
    await renderAdminMonthlyProd();
  };

  window.deleteAdminMakeupSession=async function(id){
    if(!confirm("이 보강 일정을 삭제할까요?"))return;
    const {error}=await db.from("class_sessions").delete().eq("id",id).eq("kind","makeup");
    if(error)return notify("보강 삭제 실패: "+error.message);
    notify("보강 일정을 삭제했습니다.");
    await renderAdminMonthlyProd();
  };

  window.addAdminMakeupSession=async function(){
    const classId=$("adminScheduleClass")?.value,date=$("adminMakeupDate")?.value,month=$("adminMonthlyMonth")?.value;
    if(!classId)return notify("반을 선택해주세요.");
    if(!date)return notify("보강 날짜를 선택해주세요.");
    if(month && date.slice(0,7)!==month)return notify("현재 확인 중인 월 안에서 보강 날짜를 선택해주세요.");
    const {data:existing,error:findErr}=await db.from("class_sessions").select("id,kind,status").eq("class_id",classId).eq("session_date",date).maybeSingle();
    if(findErr)return notify("일정 확인 실패: "+findErr.message);
    if(existing){
      if(existing.kind==="makeup" && existing.status==="cancelled"){
        const {error}=await db.from("class_sessions").update({status:"scheduled"}).eq("id",existing.id);
        if(error)return notify("보강 복구 실패: "+error.message);
        notify("보강 일정을 다시 활성화했습니다.");
        return renderAdminMonthlyProd();
      }
      return notify("이미 해당 날짜에 수업 일정이 있습니다.");
    }
    const {error}=await db.from("class_sessions").insert({class_id:classId,session_date:date,kind:"makeup",status:"scheduled",note:"보강"});
    if(error)return notify("보강 추가 실패: "+error.message);
    notify("보강 일정을 추가했습니다.");
    await renderAdminMonthlyProd();
  };

  async function renderAdminMonthlyProd(){
    const input=$("adminMonthlyMonth"),root=$("adminMonthlyTeacherGroups");if(!input||!root)return;
    if(!input.value) input.value=todayISO().slice(0,7);
    const month=input.value,{start,end}=monthDateRange(month);

    const {data:classes,error}=await db.from("classes")
      .select("id,term,program,weekday,class_time,start_date,end_date,status,teacher_id,created_at,centers(name),profiles!classes_teacher_id_fkey(name)")
      .order("created_at",{ascending:false});
    if(error) throw error;

    await ensureAdminMonthSessions(classes||[],month);

    const {data:sessions,error:sErr}=await db.from("class_sessions")
      .select("id,class_id,session_date,kind,status,note")
      .gte("session_date",start).lte("session_date",end)
      .order("session_date");
    if(sErr) throw sErr;

    await renderAdminScheduleManager(classes||[],sessions||[],month);

    const classIds=(classes||[]).map(c=>c.id);
    const enrollments=classIds.length ? (await db.from("enrollments").select("class_id,child_id").in("class_id",classIds).eq("active",true)).data||[] : [];
    const growth=classIds.length ? (await db.from("growth_records").select("class_id,child_id,lesson_date").in("class_id",classIds).gte("lesson_date",start).lte("lesson_date",end)).data||[] : [];
    const absent=classIds.length ? (await db.from("attendance").select("class_id,child_id,lesson_date").in("class_id",classIds).gte("lesson_date",start).lte("lesson_date",end).eq("status","absent")).data||[] : [];

    const classMap=new Map((classes||[]).map(c=>[c.id,c]));
    const enrolledMap=new Map();
    enrollments.forEach(e=>{if(!enrolledMap.has(e.class_id))enrolledMap.set(e.class_id,new Set());enrolledMap.get(e.class_id).add(e.child_id);});
    const processedMap=new Map();
    [...growth,...absent].forEach(r=>{
      const k=r.class_id+"|"+r.lesson_date;
      if(!processedMap.has(k))processedMap.set(k,new Set());
      processedMap.get(k).add(r.child_id);
    });

    const groups={};
    for(const s of sessions||[]){
      if(s.status==="cancelled")continue;
      const c=classMap.get(s.class_id);if(!c)continue;
      const key=(c.profiles?.name||"")+"|"+(c.centers?.name||"");
      groups[key] ||= {teacher:c.profiles?.name||"",center:c.centers?.name||"",scheduled:0,completed:0};
      groups[key].scheduled++;
      const students=enrolledMap.get(c.id)||new Set();
      const processed=processedMap.get(c.id+"|"+s.session_date)||new Set();
      if(students.size>0 && processed.size>=students.size) groups[key].completed++;
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
      card.innerHTML=`<div class="admin-monthly-teacher-head"><div><div class="admin-monthly-teacher-name">${escape(teacher||"미배정")} 강사</div><div class="muted">담당 센터 ${centers.length}곳</div></div><div class="admin-monthly-teacher-rate"><span class="muted">월 전체</span><b>${c} / ${s}회 완료</b><strong>${s?Math.round(c/s*100):0}%</strong></div></div><div class="admin-monthly-centers"></div>`;
      const box=q(".admin-monthly-centers",card);
      centers.forEach(x=>{
        const row=document.createElement("div");row.className="admin-monthly-center-row";
        row.innerHTML=`<div class="admin-monthly-center-name">${escape(x.center)}</div><div class="admin-monthly-center-cell"><span class="admin-monthly-center-label">실제 수업</span><span>${x.scheduled}회</span></div><div class="admin-monthly-center-cell"><span class="admin-monthly-center-label">전원완료</span><span>${x.completed}회</span></div><div class="admin-monthly-center-cell"><span class="admin-monthly-center-label">미완료</span><span>${Math.max(x.scheduled-x.completed,0)}회</span></div><div class="admin-monthly-center-cell"><span class="admin-monthly-center-label">완료율</span><span class="admin-monthly-center-rate">${x.scheduled?Math.round(x.completed/x.scheduled*100):0}%</span></div>`;
        box.appendChild(row);
      });
      root.appendChild(card);
    });
    if(!vals.length) root.innerHTML='<div class="prod-empty">해당 월에 예정된 실제 수업이 없습니다.</div>';
  }
  window.renderAdminMonthlyTracking=renderAdminMonthlyProd;

  // ---------- Realtime ----------
  function subscribeRealtime(){
    if(realtimeChannel) return;
    realtimeChannel=db.channel("growlog-live")
      .on("postgres_changes",{event:"*",schema:"public",table:"classes"},refreshVisible)
      .on("postgres_changes",{event:"*",schema:"public",table:"enrollments"},refreshVisible)
      .on("postgres_changes",{event:"*",schema:"public",table:"growth_records"},refreshVisible)
      .on("postgres_changes",{event:"*",schema:"public",table:"attendance"},refreshVisible)
      .on("postgres_changes",{event:"*",schema:"public",table:"class_sessions"},refreshVisible)
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
      if(visible==="teacher"){
        const keepClass=activeClass;
        const keepDate=activeLessonDate;
        if(keepClass && !$("teacherClassWorkView")?.classList.contains("hide")){
          // 작업 중인 반을 유지하면서 현재 날짜 데이터만 갱신합니다.
          activeClass=keepClass;
          activeLessonDate=keepDate;
          await renderTeacherScheduleManagerProd(false);
          await loadTeacherInquiries();
        }else{
          await loadTeacherDashboard(profile.role==="admin");
        }
      }
      if(visible==="admin") await loadAdminDashboard();
    },350);
  }

  // ---------- Init ----------
  async function init(){
    prepareParentProductionShell();
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
        try{
          await finishPendingParentRegistration();
          await routeAuthenticated();
        }
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
