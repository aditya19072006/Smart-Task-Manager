const GEMINI_API_KEY = ""; // local conversational AI (no external key required)

async function askGemini(message) {
  const m = (message || "").trim();
  const userText = m.toLowerCase();

  // Initialize small memory slots on state if not present
  if (!state._lastUser) state._lastUser = null;
  if (!state._lastBot) state._lastBot = null;

  // If user repeated the same exact question, give a friendly follow-up variant
  if (state._lastUser && state._lastUser.toLowerCase() === userText) {
    const followUps = [
      "You already asked that — would you like more details or examples?",
      "I mentioned that earlier. Tell me which part you want expanded.",
      "I can go deeper or give a step-by-step if you want — what would you like?"
    ];
    // pick a follow-up different from last bot reply when possible
    let pick = followUps[Math.floor(Math.random() * followUps.length)];
    if (state._lastBot && pick === state._lastBot) pick = followUps[(Math.floor(Math.random() * followUps.length) + 1) % followUps.length];
    return pick;
  }

  // Generate base reply using the previous heuristic rules
  let reply = "I'm here to help! Ask me about tasks, focus sessions, XP & streaks, team, priorities, categories, deadlines, or how to use the app.";

  if (userText.includes("task") || userText.includes("todo")) {
    reply = `You have ${state.tasks.length} personal tasks. Open the Tasks view to manage them or say 'add task' to create one.`;
  } else if (userText.includes("focus") || userText.includes("pomodoro") || userText.includes("timer")) {
    reply = `Your focus timer is set to ${state.focusMinutes} minutes. Click "Start Focus Mode" to begin a session and earn XP.`;
  } else if (userText.includes("xp") || userText.includes("point") || userText.includes("score")) {
    const tier = state.xP >= 1200 ? "Platinum" : state.xP >= 700 ? "Gold" : state.xP >= 300 ? "Silver" : "Bronze";
    reply = `You have ${state.xP} XP and are in the ${tier} Tier. Complete more tasks to level up!`;
  } else if (userText.includes("team") || userText.includes("member")) {
    reply = `Your team has ${state.team.length} members. Use the Team view to assign or review tasks.`;
  } else if (userText.includes("dashboard") || userText.includes("view")) {
    reply = `The Dashboard shows metrics, quick feed, and progress. ${completedTasks()} tasks completed out of ${state.tasks.length}.`;
  } else if (userText.includes("streak") || userText.includes("day")) {
    reply = `Your current streak is ${state.streak} days. Keep completing tasks to build momentum!`;
  } else if (userText.includes("priority")) {
    reply = `Priorities: 🟢 Low, 🟡 Medium, 🔴 High. Set priority to focus on what matters.`;
  } else if (userText.includes("category")) {
    reply = `Categories: 📚 Study, 💼 Work, 🌿 Personal, 🚀 Project. Use them to organize tasks.`;
  } else if (userText.includes("help") || userText.includes("how")) {
    reply = `I can help with tasks, focus sessions, XP tracking, team management and more — ask me anything about this app.`;
  } else if (userText.includes("hello") || userText.includes("hi") || userText.includes("hey")) {
    reply = `Hello! 👋 I'm your Task Manager assistant. Ask me about your tasks, focus timer, XP, or team.`;
  } else if (userText.includes("time") || userText.includes("due") || userText.includes("deadline")) {
    const overdue = [...state.tasks, ...state.team].filter(t => isOverdue(t));
    if (overdue.length > 0) {
      reply = `⚠️ You have ${overdue.length} overdue task(s). Most urgent: "${overdue[0].title}".`;
    } else {
      reply = `No overdue tasks right now. You're up to date.`;
    }
  } else if (userText.includes("theme") || userText.includes("dark") || userText.includes("light")) {
    reply = `Toggle theme using the sun/moon icon in the top bar.`;
  }

  // If this reply equals the last bot reply, append a short suggestion to avoid exact repetition
  if (state._lastBot && reply === state._lastBot) {
    reply += " — you can ask me to 'explain more' or 'give steps' for extra detail.";
  }

  return reply;
}

// --- New: LLM integration with OpenAI (optional) and action handling ---
const OPENAI_API_KEY = ""; // <- paste your OpenAI API key here if you have one

async function askAI(message){
  // If user has provided an OpenAI key, use it for natural conversation.
  if(OPENAI_API_KEY && OPENAI_API_KEY.trim()){
    try{
      const systemPrompt = `You are an assistant embedded inside a task manager web app. Keep replies concise and conversational. When you want the web app to perform an action (navigate, open a task, or provide structured stats), include a single JSON object wrapped between <ACTION> and </ACTION> tags, for example: <ACTION>{"action":"navigate","path":"tasks"}</ACTION>. Do not include any other JSON in the message.`;

      const recent = (state.chat || []).slice(-8).map(m=>({role: m.role==='bot' ? 'assistant' : 'user', content: m.text}));
      const messages = [{role:'system', content: systemPrompt}, ...recent, {role:'user', content: message}];

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({ model: 'gpt-3.5-turbo', messages, max_tokens: 500, temperature: 0.7 })
      });

      const data = await resp.json();
      console.log('OPENAI RESPONSE', data);
      if(data.error) return data.error.message || 'LLM error';
      const aiText = data.choices?.[0]?.message?.content || '';

      // Look for <ACTION>...</ACTION> JSON block
      const m = aiText.match(/<ACTION>([\s\S]*?)<\/ACTION>/);
      if(m){
        try{
          const actionObj = JSON.parse(m[1]);
          // execute action (navigation, open, stats, etc.)
          executeAction(actionObj);
          // remove the action block from the visible text
          const cleaned = aiText.replace(m[0], '').trim();
          if(actionObj.action === 'navigate'){
            const p = (actionObj.path||'').replace(/^\//,'');
            return (cleaned ? cleaned + '\n\n' : '') + `Navigated to ${p}.`;
          }
          if(actionObj.action === 'stats'){
            const statsText = getStatsText(actionObj);
            return (cleaned ? cleaned + '\n\n' : '') + statsText;
          }
          return cleaned || 'Action executed.';
        }catch(err){
          console.warn('Action parse failed', err);
        }
      }

      return aiText;
    }catch(err){
      console.error('OpenAI call failed', err);
      // fallback to local assistant
      return await askGemini(message);
    }
  }

  // No OpenAI key configured — fallback to local assistant
  return await askGemini(message);
}

function executeAction(obj){
  if(!obj || !obj.action) return;
  if(obj.action === 'navigate' && obj.path){
    const p = obj.path.replace(/^\//,'');
    // map known paths to views
    const map = { tasks: 'tasks', dashboard: 'dashboard', analytics: 'analytics', team: 'team', chat: 'chat' };
    const view = map[p] || p;
    try{ switchView(view); }catch(e){console.warn(e)}
  }
  if(obj.action === 'open_task' && obj.id){
    const item = findItem(obj.id, obj.source || 'personal');
    if(item){
      DOM.inspectBody.innerHTML = `<p><strong>${item.title}</strong></p><p>${item.notes}</p><p>Priority: ${item.priority}</p><p>Due: ${item.due}</p>`;
      DOM.inspectModal.classList.remove('hidden');
    }
  }
}

function getStatsText(){
  const total = state.tasks.length;
  const pending = state.tasks.filter(t=>taskStateOf(t)==='pending').length;
  const completed = completedTasks();
  const overdue = state.tasks.filter(t=>taskStateOf(t)==='overdue').length;
  return `Tasks — total: ${total}, pending: ${pending}, completed: ${completed}, overdue: ${overdue}. Team items: ${state.team.length}.`;
}





/* Block 


1: Helpers */
function getInitials(name){ return (name||"Guest User").split(" ").map(v=>v[0]).join("").slice(0,2).toUpperCase(); }
function getCategoryEmoji(cat){ return ({study:"📘",work:"💼",personal:"🫶",project:"🚀"}[cat]||"🗂️"); }
function getPriorityColor(priority){ return ({low:"#2d9a5e",medium:"#ffb703",high:"#d94848"}[priority]||"#2d9a5e"); }
function getFutureDateISO(days=1){ const d=new Date(); d.setDate(d.getDate()+days); return d.toISOString().slice(0,16); }
function formatMinutes(ms){ const s=Math.max(0,Math.floor(ms/1000)); const m=Math.floor(s/60); const r=s%60; return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`; }
function safeJSONParse(raw,fallback){ try{return JSON.parse(raw)||fallback}catch(e){return fallback;} }
function clamp(n,min,max){ return Math.min(max,Math.max(min,n)); }
function tierFromXP(xp){ if(xp>=1200) return "Platinum"; if(xp>=700) return "Gold"; if(xp>=300) return "Silver"; return "Bronze"; }
function percentToDeg(p){ return Math.round(clamp(p,0,100)*3.6); }
function toast(message){ const el=document.createElement("div"); el.className="toast"; el.textContent=message; DOM.toastStack.appendChild(el); setTimeout(()=>el.remove(),2600); }
function isOverdue(task){ return task.status!=="completed" && task.due && new Date(task.due).getTime()<Date.now(); }
function taskStateOf(task){ if(task.status==="completed") return "completed"; if(isOverdue(task)) return "overdue"; return "pending"; }

/* Block 2: State */
const state = {
  auth:false,
  user:{name:"Guest User", email:"guest@smarttask.app", initials:"GU"},
  tasks:[
    {id:"t1",title:"Revise recursion notes",notes:"Study stack traces and base cases",category:"study",priority:"high",due:getFutureDateISO(1),cost:50,status:"pending",subtasks:["Read notes","Solve 3 problems"],source:"personal"},
    {id:"t2",title:"Design landing hero",notes:"Build responsive header module",category:"work",priority:"medium",due:getFutureDateISO(2),cost:40,status:"completed",subtasks:["Wireframe","Apply styles"],source:"personal"},
    {id:"t3",title:"Prepare chemistry quiz",notes:"Focus on formulas and key concepts",category:"study",priority:"medium",due:getFutureDateISO(3),cost:30,status:"pending",subtasks:["Review chapter","Practice MCQs"],source:"personal"},
    {id:"t4",title:"Fix bug tracker flow",notes:"Refactor event router and modal logic",category:"work",priority:"high",due:getFutureDateISO(-1),cost:60,status:"pending",subtasks:["Inspect bug","Patch state"],source:"personal"},
    {id:"t5",title:"Gym session",notes:"Evening routine and hydration",category:"personal",priority:"low",due:getFutureDateISO(0),cost:20,status:"completed",subtasks:["Warm up","Stretch"],source:"personal"},
  ],
  team:[
    {id:"m1",title:"Integrate API status card",notes:"Collaborative module for QA",category:"project",priority:"high",due:getFutureDateISO(1),cost:70,status:"pending",owner:"Aarav",subtasks:["API schema","Status badge"],source:"team"},
    {id:"m2",title:"Review mobile spacing",notes:"Adjust grid for small screens",category:"project",priority:"medium",due:getFutureDateISO(2),cost:35,status:"pending",owner:"Meera",subtasks:["Test breakpoints","Tune paddings"],source:"team"},
    {id:"m3",title:"Sprint demo storyline",notes:"Prepare presentation flow",category:"project",priority:"low",due:getFutureDateISO(4),cost:25,status:"completed",owner:"Kabir",subtasks:["Outline","Slides"],source:"team"},
    {id:"m4",title:"Audit shared deletes",notes:"Validate unified deletion router",category:"project",priority:"high",due:getFutureDateISO(-1),cost:55,status:"pending",owner:"Isha",subtasks:["Confirm IDs","Filter arrays"],source:"team"},
  ],
  goals:[
    ["Ship task builder","Reach 300 XP","Complete 5 deep-work blocks"],
    ["Keep streak alive","Clear overdue items","Send 3 team updates"]
  ],
  filters:{task:"all"},
  quotes:{
    a:"Small wins build big momentum.",
    b:"Consistency beats intensity.",
    c:"Focus is a multiplier.",
    d:"Done is better than perfect.",
    e:"Build the habit, then the system."
  },
  xP:220,
  streak:4,
  focusMinutes:25,
  focusRunning:false,
  focusEndsAt:null,
  view:"dashboard",
  pendingDelete:null,
  activeAuthTab:"signin",
  chat:[
    {role:"bot", text:"I’m your context co-pilot. Ask me about tasks, focus, or structure."}
  ]
};

/* Block 3: Auth */
function handleLogin(){
  const email = DOM.signinEmail.value.trim();
  const pass = DOM.signinPassword.value.trim();
  if(!email || !pass){ toast("Enter email and password."); return; }
  state.auth=true;
  state.user={name:email.split("@")[0], email, initials:getInitials(email.split("@")[0])};
  persistSession();
  enterApp();
  toast("Signed in successfully.");
}
function handleSignup(){
  const name = DOM.signupName.value.trim();
  const email = DOM.signupEmail.value.trim();
  const pass = DOM.signupPassword.value.trim();
  if(!name || !email || !pass){ toast("Complete all signup fields."); return; }
  state.auth=true;
  state.user={name, email, initials:getInitials(name)};
  persistSession();
  enterApp();
  toast("Account created.");
}
function persistSession(){
  localStorage.setItem("smarttask_session", JSON.stringify({auth:state.auth,user:state.user,theme:document.body.classList.contains("dark")?"dark":"light"}));
}

/* Block 4: DOM */
const DOM = {};
function cacheDOM(){
  DOM.authOverlay = document.getElementById("authOverlay");
  DOM.signinEmail = document.getElementById("signinEmail");
  DOM.signinPassword = document.getElementById("signinPassword");
  DOM.signupName = document.getElementById("signupName");
  DOM.signupEmail = document.getElementById("signupEmail");
  DOM.signupPassword = document.getElementById("signupPassword");
  DOM.signinBtn = document.getElementById("signinBtn");
  DOM.signupBtn = document.getElementById("signupBtn");
  DOM.logoutBtn = document.getElementById("logoutBtn");
  DOM.sidebarFocusLabel = document.getElementById("sidebarFocusLabel");
  DOM.focusMinus = document.getElementById("focusMinus");
  DOM.focusToggle = document.getElementById("focusToggle");
  DOM.focusPlus = document.getElementById("focusPlus");
  DOM.deadlineText = document.getElementById("deadlineText");
  DOM.quoteText = document.getElementById("quoteText");
  DOM.themeToggle = document.getElementById("themeToggle");
  DOM.profileChip = document.getElementById("profileChip");
  DOM.profileDropdown = document.getElementById("profileDropdown");
  DOM.profileInitials = document.getElementById("profileInitials");
  DOM.profileName = document.getElementById("profileName");
  DOM.profileEmail = document.getElementById("profileEmail");
  DOM.dashboardView = document.getElementById("dashboardView");
  DOM.tasksView = document.getElementById("tasksView");
  DOM.analyticsView = document.getElementById("analyticsView");
  DOM.teamView = document.getElementById("teamView");
  DOM.chatView = document.getElementById("chatView");
  DOM.navLinks = [...document.querySelectorAll(".nav-link")];
  DOM.metricTotal = document.getElementById("metricTotal");
  DOM.metricPending = document.getElementById("metricPending");
  DOM.metricCompleted = document.getElementById("metricCompleted");
  DOM.metricOverdue = document.getElementById("metricOverdue");
  DOM.quickFeed = document.getElementById("quickFeed");
  DOM.xpTotal = document.getElementById("xpTotal");
  DOM.xpProgress = document.getElementById("xpProgress");
  DOM.xpPercent = document.getElementById("xpPercent");
  DOM.dayStreak = document.getElementById("dayStreak");
  DOM.tierLabel = document.getElementById("tierLabel");
  DOM.goalNotes = document.getElementById("goalNotes");
  DOM.donutGauge = document.getElementById("donutGauge");
  DOM.donutPercent = document.getElementById("donutPercent");
  DOM.taskTitle = document.getElementById("taskTitle");
  DOM.taskNotes = document.getElementById("taskNotes");
  DOM.taskCategory = document.getElementById("taskCategory");
  DOM.taskDue = document.getElementById("taskDue");
  DOM.taskCost = document.getElementById("taskCost");
  DOM.taskCostLabel = document.getElementById("taskCostLabel");
  DOM.addTaskBtn = document.getElementById("addTaskBtn");
  DOM.aiPlanBtn = document.getElementById("aiPlanBtn");
  DOM.taskFeed = document.getElementById("taskFeed");
  DOM.taskFilters = document.getElementById("taskFilters");
  DOM.activityChart = document.getElementById("activityChart");
  DOM.efficiencyValue = document.getElementById("efficiencyValue");
  DOM.efficiencyCircle = document.getElementById("efficiencyCircle");
  DOM.teamFeed = document.getElementById("teamFeed");
  DOM.chatLog = document.getElementById("chatLog");
  DOM.chatInput = document.getElementById("chatInput");
  DOM.sendChatBtn = document.getElementById("sendChatBtn");
  DOM.inspectModal = document.getElementById("inspectModal");
  DOM.inspectBody = document.getElementById("inspectBody");
  DOM.deleteModal = document.getElementById("deleteModal");
  DOM.deletePrompt = document.getElementById("deletePrompt");
  DOM.confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
  DOM.toastStack = document.getElementById("toastStack");
  DOM.profileName = document.getElementById("profileName");
  
  DOM.startFocusModeBtn = document.getElementById("startFocusModeBtn");
  DOM.topbarFocusModeBtn = document.getElementById("topbarFocusModeBtn");
  DOM.focusConfirmModal = document.getElementById("focusConfirmModal");
  DOM.focusTaskSelect = document.getElementById("focusTaskSelect");
  DOM.confirmFocusBtn = document.getElementById("confirmFocusBtn");
  DOM.logoutConfirmModal = document.getElementById("logoutConfirmModal");
  DOM.confirmLogoutBtn = document.getElementById("confirmLogoutBtn");
  DOM.focusWorkspace = document.getElementById("focusWorkspace");
  DOM.focusCountdown = document.getElementById("focusCountdown");
  DOM.focusProgressRingFill = document.getElementById("focusProgressRingFill");
  DOM.taskBuilderModal = document.getElementById("taskBuilderModal");
  DOM.addTeamModal = document.getElementById("addTeamModal");
  DOM.addTeamBtn = document.getElementById("addTeamBtn");
  DOM.confirmAddTeamBtn = document.getElementById("confirmAddTeamBtn");
  DOM.teamMemberName = document.getElementById("teamMemberName");
  DOM.teamMemberRole = document.getElementById("teamMemberRole");
  DOM.teamTaskTitle = document.getElementById("teamTaskTitle");
  DOM.teamTaskPriority = document.getElementById("teamTaskPriority");
  DOM.teamTaskDue = document.getElementById("teamTaskDue");
  DOM.openTaskModalBtn = document.getElementById("openTaskModalBtn");
}

/* Block 5: Init */
document.addEventListener("DOMContentLoaded", initApp);
function initApp(){
  cacheDOM();
  bindEvents();
  loadSession();
  DOM.taskDue.value = getFutureDateISO(2);
  DOM.taskCostLabel.textContent = `${DOM.taskCost.value} min`;
  DOM.profileInitials.textContent = state.user.initials;
  renderAll();
function startClockLoop(){
  // Clock loop placeholder
}
  startFocusLoop();
  setQuote();
  setDeadlineAlert();
  updateThemeUI();
  if(!state.auth){ DOM.authOverlay.classList.remove("hidden"); }
}

/* Block 6: Renderers */
function renderAll(){
  renderDashboard();
  renderTasks();
  renderTeam();
  renderAnalytics();
  renderChat();
  updateMetrics();
}
function renderDashboard(){
  const recent = [...state.tasks].slice(0,5);
  DOM.quickFeed.innerHTML = recent.map(t=>`
    <article class="feed-item">
      <div class="task-card-top">
        <strong>${getCategoryEmoji(t.category)} ${t.title}</strong>
        <span class="tag">${t.category}</span>
      </div>
      <p>${t.notes}</p>
    </article>`).join("");
  DOM.goalNotes.innerHTML = state.goals.flat().map(g=>`<div class="goal-note">${g}</div>`).join("");
  const tier = tierFromXP(state.xP);
  DOM.tierLabel.textContent = `${tier} Tier`;
  DOM.xpTotal.textContent = `${state.xP} XP`;
  const p = clamp((state.xP%300)/3,0,100);
  DOM.xpProgress.style.width = `${p}%`;
  DOM.xpPercent.textContent = `${Math.round(p)}%`;
  DOM.dayStreak.textContent = `Day Streak: ${state.streak}`;
  DOM.donutPercent.textContent = `${Math.round((completedTasks()/state.tasks.length)*100)}%`;
  const donutDeg = percentToDeg((completedTasks()/Math.max(1,state.tasks.length))*100);
  DOM.donutGauge.style.background = `conic-gradient(var(--green-bright) ${donutDeg}deg,var(--border) 0deg)`;
}
function renderTasks(){
  const items = state.tasks.filter(t=>state.filters.task==="all" ? true : taskStateOf(t)===state.filters.task);
  DOM.taskFeed.innerHTML = items.map(taskCardHTML).join("") || "<div class='feed-item'>No tasks found.</div>";
}
function renderTeam(){
  DOM.teamFeed.innerHTML = state.team.map(taskCardHTML).join("");
}
function renderAnalytics(){
  const bars = [12,26,18,34,28,46,38];
  DOM.activityChart.innerHTML = bars.map((h,i)=>`<div class="bar" style="height:${h}%"><span>Day ${i+1}</span></div>`).join("");
  DOM.efficiencyValue.textContent = `${Math.min(99,50 + completedTasks()*8)}%`;
  DOM.efficiencyCircle.style.background = `linear-gradient(135deg,var(--green-core),var(--green-bright))`;
}
function renderChat(){
  DOM.chatLog.innerHTML = state.chat.map(m=>`<div class="chat-bubble ${m.role}">${m.text}</div>`).join("");
  DOM.chatLog.scrollTop = DOM.chatLog.scrollHeight;
}
function taskCardHTML(t){
  return `
  <article class="task-card" data-id="${t.id}" data-source="${t.source}">
    <div class="task-card-top">
      <div>
        <strong>${getCategoryEmoji(t.category)} ${t.title}</strong>
        <div class="task-meta">
          <span class="tag">${t.priority}</span>
          ${t.owner ? `<span class="tag">Owner: ${t.owner}</span>` : ""}
          <span class="tag">${taskStateOf(t)}</span>
        </div>
      </div>
      <span class="tag" style="color:${getPriorityColor(t.priority)}">${t.cost} min</span>
    </div>
    <p>${t.notes}</p>
    <div class="task-meta">
      <small>Due: ${new Date(t.due).toLocaleString()}</small>
      <small>${(t.subtasks||[]).length} subtasks</small>
    </div>
    <div class="task-actions">
      ${t.status !== "completed" ? `<button class="btn btn-primary complete-btn" data-complete="${t.id}" data-source="${t.source}"><i class="fa-solid fa-check"></i> Complete +50 XP</button>` : `<span class="tag" style="background:var(--green-tint);color:var(--green-core)">✅ Done</span>`}
      <button class="btn btn-ghost inspect-btn" data-inspect="${t.id}" data-source="${t.source}"><i class="fa-solid fa-magnifying-glass"></i> Inspect</button>
      <button class="btn btn-danger delete-btn" data-delete="${t.id}" data-source="${t.source}"><i class="fa-solid fa-trash"></i></button>
    </div>
  </article>`;
}

/* Block 7: Focus clock */
let focusTimer = null;
function refreshFocusLabel(){
  DOM.sidebarFocusLabel.textContent = formatMinutes(state.focusMinutes*60000);
}
function startFocusLoop(){
  refreshFocusLabel();
  if(focusTimer) clearInterval(focusTimer);
  focusTimer = setInterval(()=>{
    if(!state.focusRunning) return;
    state.focusEndsAt -= 1000;
    if(state.focusEndsAt <= Date.now()){
      state.focusRunning=false;
      state.xP += 150;
      state.streak += 1;
      state.focusEndsAt=null;
      toast("Focus session complete. +150 XP");
      refreshFocusLabel();
      renderAll();
      persistSession();
      DOM.focusToggle.textContent="Start";
      return;
    }
    const remain = state.focusEndsAt - Date.now();
    DOM.sidebarFocusLabel.textContent = formatMinutes(remain);
  },1000);
}
function toggleFocus(){
  if(state.focusRunning){
    state.focusRunning=false;
    DOM.focusToggle.textContent="Start";
    toast("Focus paused.");
  } else {
    state.focusRunning=true;
    state.focusEndsAt=Date.now()+state.focusMinutes*60000;
    DOM.focusToggle.textContent="Pause";
    toast("Focus started.");
  }
}
function adjustFocus(delta){
  if(state.focusRunning) return;
  state.focusMinutes = clamp(state.focusMinutes + delta, 5, 120);
  refreshFocusLabel();
  toast(`Focus set to ${state.focusMinutes} minutes.`);
}

/* Block 8: AI pipelines */
function recommendSubtasks(title, notes){
  const base = [title, notes].join(" ").toLowerCase();
  if(base.includes("study")) return ["Break topic into 3 sections","Review examples","Do a recall quiz"];
  if(base.includes("design")) return ["Draft wireframe","Define spacing scale","Check responsiveness"];
  if(base.includes("fix") || base.includes("bug")) return ["Reproduce issue","Inspect state flow","Confirm regression test"];
  return ["Clarify goal","List dependencies","Schedule a review"];
}
function respondToChat(text){
  const lower = text.toLowerCase();
  if(lower.includes("task")){
    return `You have ${state.tasks.length} personal tasks and ${state.team.length} team items.`;
  }
  if(lower.includes("algorithm") || lower.includes("structure")){
    return "Use arrays for feeds, objects for state, and one shared router for delete actions.";
  }
  if(lower.includes("pomodoro") || lower.includes("focus")){
    return `Your focus timer is set to ${state.focusMinutes} minutes.`;
  }
  return "I can summarize progress, suggest subtasks, or explain the state model.";
}

/* Block 9: Events */
function bindEvents(){
  DOM.signinBtn.addEventListener("click", handleLogin);
  DOM.signupBtn.addEventListener("click", handleSignup);
  document.querySelectorAll(".auth-switch .tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".auth-switch .tab").forEach(t=>t.classList.remove("active"));
      document.querySelectorAll(".auth-card").forEach(c=>c.classList.remove("active"));
      btn.classList.add("active");
      state.activeAuthTab = btn.dataset.authTab;
      document.querySelector(`[data-auth-card="${btn.dataset.authTab}"]`).classList.add("active");
    });
  });
  document.querySelectorAll(".oauth-btn").forEach(btn=>btn.addEventListener("click", ()=>toast(`${btn.dataset.provider} auth simulated.`)));
  
  DOM.logoutBtn.addEventListener("click", () => {
    DOM.logoutConfirmModal.classList.remove("hidden");
  });
  if (DOM.confirmLogoutBtn) {
    DOM.confirmLogoutBtn.addEventListener("click", () => {
      DOM.logoutConfirmModal.classList.add("hidden");
      logout();
    });
  }

  DOM.focusMinus.addEventListener("click", ()=>adjustFocus(-5));
  DOM.focusPlus.addEventListener("click", ()=>adjustFocus(5));
  DOM.focusToggle.addEventListener("click", toggleFocus);
  DOM.themeToggle.addEventListener("click", toggleTheme);
  DOM.profileChip.addEventListener("click", ()=>DOM.profileDropdown.classList.toggle("hidden"));
  DOM.navLinks.forEach(btn=>btn.addEventListener("click", ()=>switchView(btn.dataset.view)));

  // Open task builder modal button (in task list header)
  if (DOM.openTaskModalBtn) DOM.openTaskModalBtn.addEventListener("click", () => {
    DOM.taskDue.value = getFutureDateISO(2);
    DOM.taskBuilderModal.classList.remove("hidden");
  });
  // addTaskBtn is INSIDE the modal — submits the form
  DOM.addTaskBtn.addEventListener("click", addTask);

  DOM.aiPlanBtn.addEventListener("click", aiPlanTask);
  DOM.taskCost.addEventListener("input", ()=>DOM.taskCostLabel.textContent = `${DOM.taskCost.value} min`);
  DOM.taskFilters.addEventListener("click", e=>{ const b=e.target.closest(".tab"); if(!b) return; state.filters.task=b.dataset.filter; DOM.taskFilters.querySelectorAll(".tab").forEach(x=>x.classList.remove("active")); b.classList.add("active"); renderTasks(); });
  DOM.taskFeed.addEventListener("click", unifiedActionRouter);
  DOM.teamFeed.addEventListener("click", unifiedActionRouter);
  DOM.confirmDeleteBtn.addEventListener("click", confirmDelete);

  // Add Team Member
  if (DOM.addTeamBtn) DOM.addTeamBtn.addEventListener("click", () => {
    DOM.teamTaskDue.value = getFutureDateISO(2);
    DOM.addTeamModal.classList.remove("hidden");
  });
  if (DOM.confirmAddTeamBtn) DOM.confirmAddTeamBtn.addEventListener("click", addTeamMember);
  
  const openFocusModal = () => {
    const minuteDisplay = document.getElementById("focusMinuteDisplay");
    if (minuteDisplay) minuteDisplay.textContent = state.focusMinutes;
    DOM.focusConfirmModal.classList.remove("hidden");
  };
  if (DOM.startFocusModeBtn) DOM.startFocusModeBtn.addEventListener("click", openFocusModal);
  if (DOM.topbarFocusModeBtn) DOM.topbarFocusModeBtn.addEventListener("click", openFocusModal);
  
  if (DOM.confirmFocusBtn) {
    DOM.confirmFocusBtn.addEventListener("click", () => {
      DOM.focusConfirmModal.classList.add("hidden");
      enterFullscreenFocus();
    });
  }

  document.body.addEventListener("click", e=>{
    if(e.target.closest("[data-close='deleteModal']")) DOM.deleteModal.classList.add("hidden");
    if(e.target.closest("[data-close='inspectModal']")) DOM.inspectModal.classList.add("hidden");
    if(e.target.closest("[data-close='logoutConfirmModal']")) DOM.logoutConfirmModal.classList.add("hidden");
    if(e.target.closest("[data-close='focusConfirmModal']")) DOM.focusConfirmModal.classList.add("hidden");
    if(e.target.closest("[data-close='taskBuilderModal']")) DOM.taskBuilderModal.classList.add("hidden");
    if(e.target.closest("[data-close='addTeamModal']")) DOM.addTeamModal.classList.add("hidden");
    if(e.target===DOM.profileDropdown || e.target===DOM.profileChip) return;
    if(!e.target.closest("#profileDropdown")) DOM.profileDropdown.classList.add("hidden");
  });
  DOM.sendChatBtn.addEventListener("click", sendChat);
  DOM.chatInput.addEventListener("keydown", e=>{ if(e.key==="Enter") sendChat(); });
}
function switchView(view){
  state.view=view;
  [DOM.dashboardView,DOM.tasksView,DOM.analyticsView,DOM.teamView,DOM.chatView].forEach(v=>v.classList.add("hidden"));
  document.getElementById(`${view}View`).classList.remove("hidden");
  DOM.navLinks.forEach(x=>x.classList.toggle("active", x.dataset.view===view));
}
function unifiedActionRouter(e){
  const cmp = e.target.closest("[data-complete]");
  const del = e.target.closest("[data-delete]");
  const ins = e.target.closest("[data-inspect]");
  if(cmp){
    const item = findItem(cmp.dataset.complete, cmp.dataset.source);
    if(item && item.status !== "completed"){
      item.status = "completed";
      state.xP += 50;
      renderAll();
      persistSession();
      toast(`✅ "${item.title}" complete! +50 XP`);
    }
    return;
  }
  if(del){
    state.pendingDelete={id:del.dataset.delete, source:del.dataset.source};
    DOM.deletePrompt.textContent = `Delete ${state.pendingDelete.source === "team" ? "team" : "task"} item ${state.pendingDelete.id}?`;
    DOM.deleteModal.classList.remove("hidden");
  }
  if(ins){
    const item = findItem(ins.dataset.delete || ins.dataset.inspect, ins.dataset.source);
    if(item){
      DOM.inspectBody.innerHTML = `
        <p><strong>${item.title}</strong></p>
        <p>${item.notes}</p>
        <p>Priority: ${item.priority}</p>
        <p>Subtasks: ${(item.subtasks||[]).join(", ")}</p>`;
      DOM.inspectModal.classList.remove("hidden");
    }
  }
}
function confirmDelete(){
  if(!state.pendingDelete) return;
  purgeItem(state.pendingDelete.id, state.pendingDelete.source);
  state.pendingDelete=null;
  DOM.deleteModal.classList.add("hidden");
  renderAll();
  persistSession();
  toast("Item deleted.");
}
function aiPlanTask(){
  const title = DOM.taskTitle.value.trim();
  const notes = DOM.taskNotes.value.trim();
  const subtasks = recommendSubtasks(title, notes);
  DOM.taskNotes.value = notes ? `${notes}\n\nSuggested subtasks:\n- ${subtasks.join("\n- ")}` : `Suggested subtasks:\n- ${subtasks.join("\n- ")}`;
  toast("AI subtasks suggested.");
}
function addTask(){
  const title = DOM.taskTitle.value.trim();
  if(!title){ toast("Task title is required."); return; }
  const priority = document.querySelector("input[name='priority']:checked")?.value || "medium";
  const task = {
    id:`t${Date.now()}`,
    title,
    notes:DOM.taskNotes.value.trim() || "No notes provided.",
    category:DOM.taskCategory.value,
    priority,
    due:DOM.taskDue.value || getFutureDateISO(1),
    cost:+DOM.taskCost.value,
    status:"pending",
    subtasks:recommendSubtasks(title, DOM.taskNotes.value),
    source:"personal"
  };
  state.tasks.unshift(task);
  DOM.taskTitle.value=""; DOM.taskNotes.value="";
  state.xP += 20;
  DOM.taskBuilderModal.classList.add("hidden");
  renderAll(); persistSession(); toast("Task added. +20 XP");
}
function addTeamMember(){
  const name = DOM.teamMemberName.value.trim();
  const role = DOM.teamMemberRole.value.trim();
  const title = DOM.teamTaskTitle.value.trim();
  if(!name || !title){ toast("Name and task title are required."); return; }
  const member = {
    id:`tm${Date.now()}`,
    title: `[${role || "Member"}] ${title}`,
    notes: `Assigned to: ${name}`,
    category: "work",
    priority: DOM.teamTaskPriority.value,
    due: DOM.teamTaskDue.value || getFutureDateISO(2),
    cost: 30,
    status: "pending",
    subtasks: [],
    source: "team",
    owner: name
  };
  state.team.unshift(member);
  DOM.teamMemberName.value=""; DOM.teamMemberRole.value=""; DOM.teamTaskTitle.value="";
  DOM.addTeamModal.classList.add("hidden");
  renderAll(); persistSession(); toast(`👥 ${name} added to the team!`);
}
async function sendChat(){
  const text = DOM.chatInput.value.trim();

  if(!text) return;

  state.chat.push({
    role:"user",
    text
  });

  DOM.chatInput.value = "";

  state.chat.push({
    role:"bot",
    text:"Thinking..."
  });

  renderChat();

  const reply = await askAI(text);

  // persist small conversation memory to avoid immediate repeats
  state._lastUser = text;
  state._lastBot = reply;

  state.chat[state.chat.length - 1].text = reply;

  renderChat();
}

/* Block 10: Clock loop */
function setQuote(){ const keys=Object.keys(state.quotes); DOM.quoteText.textContent = state.quotes[keys[Math.floor(Math.random()*keys.length)]]; }
function setDeadlineAlert(){
  const urgent = [...state.tasks, ...state.team].filter(t=>isOverdue(t)).sort((a,b)=>new Date(a.due)-new Date(b.due))[0];
  DOM.deadlineText.textContent = urgent ? `Urgent: ${urgent.title} is overdue.` : "No urgent deadlines right now.";
}
setInterval(()=>{
  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning! 🌅" : h < 18 ? "Good afternoon! ☀️" : "Good evening! 🌙";
  DOM.quoteText.textContent = `${greeting} ${state.quotes.a}`;
},15000);

/* Block 11: Unified purge */
function findItem(id, source){
  return source==="team" ? state.team.find(t=>t.id===id) : state.tasks.find(t=>t.id===id);
}
function purgeItem(id, source){
  if(source==="team") state.team = state.team.filter(t=>t.id!==id);
  else state.tasks = state.tasks.filter(t=>t.id!==id);
}
function completedTasks(){ return state.tasks.filter(t=>t.status==="completed").length; }
function updateMetrics(){
  const all = state.tasks;
  DOM.metricTotal.textContent = all.length;
  DOM.metricPending.textContent = all.filter(t=>taskStateOf(t)==="pending").length;
  DOM.metricCompleted.textContent = all.filter(t=>t.status==="completed").length;
  DOM.metricOverdue.textContent = all.filter(t=>taskStateOf(t)==="overdue").length;
  setDeadlineAlert();
}
function toggleTheme(){
  document.body.classList.toggle("dark");
  persistSession();
}
function updateThemeUI(){
  const session = safeJSONParse(localStorage.getItem("smarttask_session"), null);
  if(session?.theme==="dark") document.body.classList.add("dark");
}
function logout(){
  state.auth=false;
  localStorage.removeItem("smarttask_session");
  DOM.authOverlay.classList.remove("hidden");
  toast("Logged out.");
}
function enterApp(){
  DOM.authOverlay.classList.add("hidden");
  DOM.profileInitials.textContent = state.user.initials;
  DOM.profileName.textContent = state.user.name;
  DOM.profileEmail.textContent = state.user.email;
}
function loadSession(){
  const session = safeJSONParse(localStorage.getItem("smarttask_session"), null);
  if(session?.auth){
    state.auth=true;
    state.user=session.user;
    if(session.theme==="dark") document.body.classList.add("dark");
    enterApp();
  }
}

/* Block 12: Fullscreen Focus Mode Functions */
let focusActiveTask = null;
let focusTimeRemaining = 0; // in seconds
let focusIntervalId = null;
let originalTimerMinutes = 25; // keep track

function enterFullscreenFocus() {
  focusTimeRemaining = state.focusMinutes * 60;
  originalTimerMinutes = state.focusMinutes;
  
  document.body.classList.add("focus-mode-active");
  
  updateFocusWorkspaceTimer();
  if (focusIntervalId) clearInterval(focusIntervalId);
  focusIntervalId = setInterval(tickFocusWorkspace, 1000);
  
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(err => {
      console.warn("Fullscreen request rejected: ", err);
    });
  } else if (document.documentElement.webkitRequestFullscreen) {
    document.documentElement.webkitRequestFullscreen();
  } else if (document.documentElement.msRequestFullscreen) {
    document.documentElement.msRequestFullscreen();
  }
  
  toast("🎯 Focus Mode activated. Stay locked in!");
}

function tickFocusWorkspace() {
  if (focusTimeRemaining <= 0) {
    clearInterval(focusIntervalId);
    focusIntervalId = null;
    
    state.xP += 150;
    state.streak += 1;
    toast("🏆 Focus session complete! +150 XP earned!");
    
    renderAll();
    persistSession();
    exitFullscreenFocus();
    return;
  }
  
  focusTimeRemaining--;
  updateFocusWorkspaceTimer();
}

function updateFocusWorkspaceTimer() {
  const minutes = Math.floor(focusTimeRemaining / 60);
  const seconds = focusTimeRemaining % 60;
  DOM.focusCountdown.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  const totalSeconds = originalTimerMinutes * 60;
  const percentage = focusTimeRemaining / totalSeconds;
  const offset = 565 - (percentage * 565);
  DOM.focusProgressRingFill.setAttribute("stroke-dashoffset", offset);
}

function exitFullscreenFocus() {
  if (focusIntervalId) {
    clearInterval(focusIntervalId);
    focusIntervalId = null;
  }
  document.body.classList.remove("focus-mode-active");
  
  if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(err => {
        console.warn("Error exiting fullscreen: ", err);
      });
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }
  toast("Focus Mode closed.");
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && !document.webkitFullscreenElement && document.body.classList.contains("focus-mode-active")) {
    exitFullscreenFocus();
  }
});