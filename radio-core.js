const CONFIG = {
    api: "https://script.google.com/macros/s/AKfycbzoQfFFkwSOoZlnX73FKn8lEtbcRSEe6CYXPeuZ6tZPG5OsBuXivvvGtBJhGJhPC7GU/exec",
    crossfadeDur: 3.5, // 3.5 segundos para fundidos estándar
    pollInterval: 15, // Refresco API seguro (Evita baneos de Google)
    defaultLogo: "https://ia600602.us.archive.org/32/items/r-maitino-psd-1400.1400/r%20maitino%20psd%201400.1400.png"
};
const SILENCE_MP3 = "data:audio/mpeg;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABpRDIzIHYyLjMuMCBhbmQgaWQzIHYyLjQuMCB0YWdzAAAAAAAAAAAA//MkxAAKAAAABpAAAAWSAAAAASU1BTUUzLjk5LjVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

let systemOn = false, userVolume = 0.9, faderLevel = 1.0, currentSourceUrl = "", currentMode = 'FILLER';
let deckA = document.getElementById('deck-a'), deckB = document.getElementById('deck-b');
let activeDeck = deckA, fadingDeck = null, fadeOutEndTime = 0, currentFadeDur = 3.5, isTransitioning = false;
let isDataLoaded = false, visStartTime = Date.now();
let library = { news: null, news30: null, chimes: null, weather: null, hours: {}, breaking: null, ads: [], jingles: [], spaces: [], promos: [], filler: [], schedule: {0:[],1:[],2:[],3:[],4:[],5:[],6:[]} };
let audioCtx, lastPipFired = -1, lastScheduleSec = -1;

const el = {
    clock: document.getElementById('clock'), title: document.getElementById('main-title'), sub: document.getElementById('sub-title'),
    img: document.getElementById('art-img'), badge: document.getElementById('status-badge'), tally: document.getElementById('tally'),
    btn: document.getElementById('pwr-btn'), sch: document.getElementById('schedule-list'), canvas: document.getElementById('visualizer-canvas')
};

// ZONA HORARIA ATÓMICA DE ESPAÑA (Soluciona bugs en oyentes extranjeros)
function getSpainTime() {
    const now = new Date();
    const esDateStr = now.toLocaleString("en-US", {timeZone: "Europe/Madrid"});
    const esDate = new Date(esDateStr);
    return {
        date: esDate, h: esDate.getHours(), m: esDate.getMinutes(), s: esDate.getSeconds(),
        ms: now.getMilliseconds(), d: esDate.getDay(), year: esDate.getFullYear(),
        secInDay: esDate.getHours() * 3600 + esDate.getMinutes() * 60 + esDate.getSeconds(),
        secInHour: esDate.getMinutes() * 60 + esDate.getSeconds()
    };
}

function safePlay(audioElem) {
    if (!audioElem || !audioElem.src || audioElem.src === window.location.href) return;
    let playPromise = audioElem.play();
    if (playPromise !== undefined) {
        playPromise.catch(err => {
            setTimeout(() => { if (systemOn && audioElem.paused) { audioElem.load(); audioElem.play().catch(e=>console.error(e)); } }, 1000);
        });
    }
}

function updateBtnState() {
    if (!systemOn) el.btn.innerHTML = '<i class="fas fa-power-off"></i>';
    else if (activeDeck.src && (activeDeck.readyState < 3 && !activeDeck.paused) && !['ESTUDIO_LIVE', 'LIVE', 'BREAKINGLIVE', 'SPORTS'].includes(currentMode)) el.btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    else el.btn.innerHTML = '<i class="fas fa-stop"></i>';
}
[deckA, deckB].forEach(d => { ['waiting','playing','canplay','stalled'].forEach(e => d.addEventListener(e, updateBtnState)); });

async function initSystem() {
    await fetchData();
    setInterval(fetchData, CONFIG.pollInterval * 1000);
}

async function fetchData() {
    try { 
        let res = await fetch(CONFIG.api, { redirect: 'follow' }); 
        let data = await res.json(); 
        processData(data); 
        isDataLoaded = true; 
        updateScheduleUI(); 
    } catch (e) { console.log("API Sync Error"); }
}

function addToSchedule(item) {
    let days = []; let s1 = String(item.dayRaw || "").trim();
    let exactDay = (s1 && s1.toLowerCase() !== "null");
    if (exactDay) {
        s1.split(/[,|]/).forEach(p => {
            p = p.trim();
            if (p.includes('-')) { let l = p.split('-'); for (let i = parseInt(l[0]); i <= parseInt(l[1]); i++) days.push(i); } 
            else if (p !== "") { days.push(parseInt(p)); }
        });
    }
    if (days.length === 0) days = [0, 1, 2, 3, 4, 5, 6];
    
    let s2 = String(item.hourRaw||"").trim(); let startSecs = -1;
    let m = s2.match(/^(\d{1,2}):(\d{2})/);
    if (m) startSecs = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60;
    
    if(startSecs !== -1) { [...new Set(days)].forEach(d => { if(library.schedule[d]) library.schedule[d].push({ ...item, startSecs: startSecs, exactDay: exactDay }); }); }
}

function processData(data) {
    let newLib = { news: null, news30: null, chimes: null, weather: null, hours: {}, breaking: null, ads: [], jingles: [], spaces: [], promos: [], filler: [], schedule: {0:[],1:[],2:[],3:[],4:[],5:[],6:[]} };
    let tSpan = getSpainTime();
    let startYear = new Date(tSpan.year, 0, 0);
    let dayOfYear = Math.floor((tSpan.date - startYear) / (1000 * 60 * 60 * 24));

    data.forEach(row => {
        if (!row.type || String(row.type).trim() === "") return;
        let rawSrc = (row.src || "").trim();
        let finalSrc = rawSrc;
        if (rawSrc.includes('|')) {
            let audioList = rawSrc.split('|').map(u => u.trim()).filter(u => u.length > 0);
            if (audioList.length > 0) finalSrc = audioList[dayOfYear % audioList.length];
        }

        let item = { src: finalSrc, title: row.title || "Emisión", artist: row.artist || "Radio Maitino", img: row.image || "", dur: parseInt(row.duration) || 300, type: row.type.toLowerCase().replace(/\s+/g, ''), dayRaw: row.day, hourRaw: row.hour };
        let t = item.type;

        if (t === 'news') newLib.news = item; 
        else if (t === 'news30') newLib.news30 = item; 
        else if (t === 'weather') newLib.weather = item;
        else if (t === 'chimes') newLib.chimes = item;
        else if (t === 'space' && !item.hourRaw) newLib.spaces.push(item);
        else if (t === 'hour') { let m = String(item.hourRaw||"").trim().match(/^(\d{1,2}):(\d{2})/); if(m) newLib.hours[parseInt(m[1], 10)] = item; else newLib.hours['default'] = item; } 
        else if (['breaking', 'breakinglive', 'estudiolive', 'emergency'].includes(t)) {
            if (item.dayRaw || item.hourRaw) { item.type = t === 'emergency' ? 'emergency' : 'estudio_live_scheduled'; addToSchedule(item); } 
            else { item.type = t === 'emergency' ? 'emergency' : (t.includes('estudio') ? 'estudio_live_breaking' : (t === 'breakinglive' ? 'breakinglive' : 'breaking')); newLib.breaking = item; }
        }
        else if (t === 'jingle') newLib.jingles.push(item); else if (t === 'ad') newLib.ads.push(item);
        else if (t === 'promo') newLib.promos.push(item);
        else if (['schedule', 'live', 'podcast', 'interview', 'off', 'sports'].includes(t)) {
            if (item.dayRaw || item.hourRaw) addToSchedule(item); else newLib.filler.push(item);
        } else { newLib.filler.push(item); }
    });
    library = newLib; // Actualización segura
}

function initAudio() {
    if (!audioCtx) { audioCtx = new(window.AudioContext || window.webkitAudioContext)(); }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function drawVisualizer() {
    if (!systemOn) return; requestAnimationFrame(drawVisualizer);
    if (document.hidden || userVolume <= 0.01) return;

    let ctx = el.canvas.getContext('2d');
    ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
    let isAudioPlaying = activeDeck && !activeDeck.paused && activeDeck.readyState >= 3;
    let time = (Date.now() - visStartTime) / 150;

    for(let i = 0; i < 32; i++) { 
        let bh = 2; 
        if (isAudioPlaying) {
            let wave = Math.sin(time + i * 0.2) * Math.cos(time * 0.8 + i * 0.5);
            bh = Math.max(2, (wave * 0.5 + 0.5) * (Math.random() * 0.5 + 0.5) * 50 * userVolume * faderLevel);
        }
        ctx.fillStyle = 'rgba(208, 2, 27, 0.85)'; 
        ctx.fillRect(i * (140/32), 60 - bh, (140/32)*0.8, bh); 
    }
}

function playPip(dur) {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    let t = audioCtx.currentTime;
    let osc = audioCtx.createOscillator(), pGain = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = 1000; osc.connect(pGain); pGain.connect(audioCtx.destination);
    pGain.gain.setValueAtTime(0, t);
    pGain.gain.setValueAtTime(userVolume * faderLevel, t + 0.001);
    pGain.gain.setValueAtTime(userVolume * faderLevel, t + dur - 0.001);
    pGain.gain.setValueAtTime(0, t + dur);
    osc.start(t); osc.stop(t + dur + 0.01);
}

function playWeatherChime() {
    if (!audioCtx || audioCtx.state === 'suspended') return;
    let t = audioCtx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => { 
        let osc = audioCtx.createOscillator(), g = audioCtx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq; osc.connect(g); g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0, t + i*0.12); g.gain.linearRampToValueAtTime((userVolume * faderLevel) * 0.35, t + i*0.12 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, t + i*0.12 + 0.6); osc.start(t + i*0.12); osc.stop(t + i*0.12 + 0.7);
    });
}

// PIPS ATÓMICOS CORREGIDOS
function gestionarPips(t) {
    if (['LIVE', 'ESTUDIO_LIVE', 'SPORTS', 'BREAKINGLIVE'].includes(currentMode)) return;

    if (t.m === 59 && t.s >= 55 && t.s <= 59) {
        if (lastPipFired !== t.s) { lastPipFired = t.s; playPip(0.1); } // Corto a los 59
    } else if (t.m === 0 && t.s === 0) {
        if (lastPipFired !== t.s) { lastPipFired = t.s; playPip(0.6); } // Largo exactamente en el 00
    } else if (t.m === 29 && t.s >= 57 && t.s <= 59) {
        if (lastPipFired !== t.s) { lastPipFired = t.s; playPip(0.1); }
    } else if (t.m === 30 && t.s === 0) {
        if (lastPipFired !== t.s) { lastPipFired = t.s; playPip(0.6); }
    } else {
        if (t.s !== 0 && t.s < 55) lastPipFired = -1; 
    }
}

function toggleBroadcast() {
    if (!systemOn) {
        initAudio(); visStartTime = Date.now(); 
        deckA.src = SILENCE_MP3; safePlay(deckA); deckB.src = SILENCE_MP3; safePlay(deckB);
        systemOn = true; el.btn.classList.add('active'); el.tally.classList.add('live'); updateBtnState(); 
        requestAnimationFrame(drawVisualizer); requestAnimationFrame(audioRenderLoop);
    } else {
        systemOn = false; el.btn.classList.remove('active'); el.tally.classList.remove('live'); updateBtnState();
        activeDeck.pause(); activeDeck.removeAttribute('src'); activeDeck.load();
        if (fadingDeck) { fadingDeck.pause(); fadingDeck.removeAttribute('src'); fadingDeck.load(); fadingDeck = null; }
        currentSourceUrl = "";
        updateDisplay({ title: "Emisión Detenida", artist: "Off Air", img: "" }, '<i class="fas fa-power-off"></i> OFF', "status-badge off");
        el.canvas.getContext('2d').clearRect(0, 0, el.canvas.width, el.canvas.height);
    }
}

function getGlobalFiller(secInDay) {
    let seq = [];
    library.filler.forEach((f, idx) => {
        seq.push(f);
        if (library.jingles.length > 0 && idx % 2 === 0) seq.push(library.jingles[idx % library.jingles.length]);
        if (library.spaces.length > 0 && idx % 4 === 0) seq.push(library.spaces[idx % library.spaces.length]);
    });
    if(seq.length === 0) return { item: { src: SILENCE_MP3, type: 'filler', dur: 300, title: 'Radio Maitino', artist: 'Emisión' }, seek: 0 };
    
    let total = seq.reduce((a, b) => a + Math.max(1, b.dur), 0);
    let c = secInDay % (total || 1);
    for (let itm of seq) {
        let idur = Math.max(1, itm.dur);
        if (c < idur) return { item: itm, seek: c };
        c -= idur;
    }
    return { item: seq[0], seek: 0 };
}

// BUCLE DE RENDERIZADO RÁPIDO (Cálculo Faders, Volumen y Gráficos)
function audioRenderLoop() {
    if (!systemOn) return;
    let t = getSpainTime(); let e = t.s + (t.ms / 1000);
    
    // Cálculos de Reloj UI
    if (t.s !== lastPipFired) {
        el.clock.innerHTML = `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}:${String(t.s).padStart(2, '0')}`;
    }

    // Curvas Fader de fin de hora
    if (t.m === 59) { 
        if (e >= 54 && e < 59) faderLevel = 1.0 - ((e - 54) / 5); 
        else if (e >= 59) { 
            faderLevel = 0.0; 
            if (!activeDeck.paused && !['LIVE','ESTUDIO_LIVE','NEWS','SPORTS','BREAKINGLIVE'].includes(currentMode)) activeDeck.pause(); 
        } 
        else faderLevel = 1.0; 
    } 
    else if (t.m === 0) faderLevel = 1.0; 
    else if (t.m === 29 && e >= 55) faderLevel = 1.0 - (0.4 * ((e - 55) / 5)); 
    else if (t.m === 30 && e < 3) faderLevel = 0.6 + (0.4 * (e / 3)); 
    else faderLevel = 1.0;

    // Crossfader Puro y Elegante
    let bv = userVolume * faderLevel;
    if (fadingDeck) {
        let fr = fadeOutEndTime - (Date.now() / 1000);
        if (fr <= 0 || faderLevel === 0.0) { 
            fadingDeck.pause(); fadingDeck.removeAttribute('src'); fadingDeck = null; 
            activeDeck.volume = Math.max(0, Math.min(1, bv)); 
        } else { 
            let r = fr / currentFadeDur; 
            fadingDeck.volume = Math.max(0, Math.min(1, bv * r)); 
            activeDeck.volume = Math.max(0, Math.min(1, bv * (1 - r))); 
        }
    } else { activeDeck.volume = Math.max(0, Math.min(1, bv)); }

    // Ejecuta chequeo lógico en cambios de segundo
    if (t.s !== lastScheduleSec) { broadcastLogic(t); lastScheduleSec = t.s; }

    requestAnimationFrame(audioRenderLoop);
}

// BUCLE LÓGICO CADA SEGUNDO
function broadcastLogic(t) {
    gestionarPips(t);
    if (t.s === 0) updateScheduleUI(t);

    let curH = (t.h === 0) ? library.chimes : (library.hours[t.h] || library.hours['default']);
    let tohSeq = [];
    if (curH) tohSeq.push({...curH, computedMode: 'HOUR'});
    if (library.news) tohSeq.push({...library.news, computedMode: 'NEWS'});
    if (library.weather) tohSeq.push({...library.weather, computedMode: 'WEATHER'});
    
    let rawTrans = [...library.spaces, ...library.promos, ...library.ads];
    let seed = t.h + (t.d * 24);
    function sRand() { let x = Math.sin(seed++) * 10000; return x - Math.floor(x); }
    rawTrans.sort(() => sRand() - 0.5);
    rawTrans.forEach(x => tohSeq.push({...x, computedMode: x.type.toUpperCase()}));
    
    // Añadimos el buffer de 5s a la "hora"
    let blockDur00 = 0;
    tohSeq.forEach(itm => { 
        itm.effectiveDur = Math.max(1, itm.dur) + (itm.computedMode === 'HOUR' ? 5 : 0); 
        blockDur00 += itm.effectiveDur; 
    });

    let toh30Seq = [];
    if (library.news30) toh30Seq.push({...library.news30, computedMode: 'NEWS30'});
    if (library.weather) toh30Seq.push({...library.weather, computedMode: 'WEATHER'});
    let blockDur30 = 0;
    toh30Seq.forEach(itm => { itm.effectiveDur = Math.max(1, itm.dur); blockDur30 += itm.effectiveDur; });

    let activeShows = (library.schedule[t.d] || []).filter(sh => t.secInDay >= sh.startSecs && t.secInDay < sh.startSecs + sh.dur);
    activeShows.sort((a, b) => (b.exactDay === a.exactDay ? (a.startSecs - b.startSecs) : (b.exactDay ? 1 : -1))); 
    let scheduledShow = activeShows[0];

    let nextItem = null, seekPos = 0, mode = 'FILLER';
    let isLiveShow = scheduledShow && ['estudio_live_scheduled', 'live', 'sports', 'estudiolive', 'breakinglive'].includes(scheduledShow.type);

    if (library.breaking) {
        if (library.breaking.type === 'estudio_live_breaking') { nextItem = library.breaking; mode = 'ESTUDIO_LIVE'; } 
        else if (library.breaking.type === 'breakinglive') { nextItem = library.breaking; mode = 'BREAKINGLIVE'; seekPos = 0; } 
        else { nextItem = library.breaking; seekPos = t.secInDay % Math.max(1, library.breaking.dur); mode = 'BREAKING'; }
    }
    else if (isLiveShow) {
        nextItem = scheduledShow; seekPos = t.secInDay - scheduledShow.startSecs;
        mode = scheduledShow.type === 'sports' ? 'SPORTS' : (scheduledShow.type.includes('estudio') ? 'ESTUDIO_LIVE' : 'LIVE');
    }
    else if (t.secInHour < blockDur00 && (!scheduledShow || scheduledShow.startSecs % 3600 === 0)) {
        let c = t.secInHour;
        for (let itm of tohSeq) { if (c < itm.effectiveDur) { nextItem = itm; seekPos = c; mode = itm.computedMode; break; } c -= itm.effectiveDur; }
    }
    else if (t.secInHour >= 1800 && t.secInHour < 1800 + blockDur30 && (!scheduledShow || scheduledShow.startSecs % 3600 === 1800)) {
        let c = t.secInHour - 1800;
        for (let itm of toh30Seq) { if (c < itm.effectiveDur) { nextItem = itm; seekPos = c; mode = itm.computedMode; break; } c -= itm.effectiveDur; }
    }
    else if (scheduledShow) {
        let delay = (scheduledShow.startSecs % 3600 === 0) ? blockDur00 : (scheduledShow.startSecs % 3600 === 1800 ? blockDur30 : 0);
        nextItem = scheduledShow; seekPos = Math.max(0, (t.secInDay - scheduledShow.startSecs) - delay); mode = 'SHOW';
    }
    else {
        let fillData = getGlobalFiller(t.secInDay);
        nextItem = fillData.item; seekPos = fillData.seek; mode = nextItem.computedMode || 'FILLER';
    }

    // Seguridad Anti-Bucle (Respetando los 5s de margen de HOUR)
    if (nextItem && activeDeck.src === nextItem.src && activeDeck.readyState >= 3) {
        let isArtificiallyExtended = (mode === 'HOUR');
        if ((activeDeck.ended || seekPos >= activeDeck.duration - 0.5) && !isArtificiallyExtended) {
            let fillData = getGlobalFiller(t.secInDay);
            nextItem = fillData.item; seekPos = fillData.seek; mode = nextItem.computedMode || 'FILLER';
        }
    }

    if (!isDataLoaded) { nextItem = { src: SILENCE_MP3, title: "Conectando...", artist: "Sintonizando emisión...", img: CONFIG.defaultLogo, type: "loading", dur: 300 }; mode = 'LOADING'; }
    else if (!nextItem) { nextItem = { src: SILENCE_MP3, title: "Emisión Continuada", artist: "Silencio", img: CONFIG.defaultLogo, type: "off", dur: 300 }; mode = 'OFF'; }

    currentMode = mode; if (nextItem) ejecutarAudio(nextItem, seekPos, mode);
}

function updateDisplay(item, badgeHtml, badgeClass) {
    let html = '<i class="fas fa-music"></i> RADIO MAITINO';
    if (badgeHtml === 'ESTUDIO_LIVE') html = '<i class="fas fa-microphone"></i> ESTUDIO EN DIRECTO';
    else if (badgeHtml === 'SPORTS') html = '<i class="fas fa-trophy"></i> DEPORTES';
    else if (badgeHtml === 'BREAKING') html = '<i class="fas fa-bolt"></i> ÚLTIMA HORA';
    else if (badgeHtml === 'BREAKINGLIVE') html = '<i class="fas fa-satellite-dish"></i> ÚLTIMA HORA DIRECTO';
    else if (badgeHtml === 'CHIMES') html = '<i class="fas fa-bell"></i> MEDIANOCHE';
    else if (badgeHtml === 'HOUR') html = '<i class="fas fa-clock"></i> SEÑAL HORARIA';
    else if (badgeHtml === 'NEWS') html = '<i class="fas fa-globe-europe"></i> BOLETÍN HORARIO';
    else if (badgeHtml === 'NEWS30') html = '<i class="fas fa-bolt"></i> TITULARES 30';
    else if (badgeHtml === 'WEATHER') html = '<i class="fas fa-cloud-sun"></i> EL TIEMPO';
    else if (badgeHtml === 'LIVE') html = '<i class="fas fa-satellite-dish"></i> CONEXIÓN EXTERNA';
    else if (badgeHtml === 'AD') html = '<i class="fas fa-bullhorn"></i> PUBLICIDAD';
    else if (badgeHtml === 'JINGLE') html = '<i class="fas fa-wave-square"></i> RADIO MAITINO';
    else if (badgeHtml === 'SPACE') html = '<i class="fas fa-comments"></i> ESPACIO DE SERVICIO';
    else if (badgeHtml === 'PROMO') html = '<i class="fas fa-star"></i> PROMOCIÓN';
    else if (badgeHtml === 'PODCAST') html = '<i class="fas fa-history"></i> DIFERIDO';
    else if (badgeHtml === 'INTERVIEW') html = '<i class="fas fa-microphone-lines"></i> ENTREVISTA';
    else if (badgeHtml === 'EMERGENCY') html = '<i class="fas fa-triangle-exclamation"></i> ALERTA TÉCNICA';
    else if (badgeHtml === 'SHOW') html = '<i class="fas fa-broadcast-tower"></i> EN DIRECTO';
    else if (badgeHtml === 'LOADING') html = '<i class="fas fa-spinner fa-spin"></i> CONECTANDO...';
    else if (badgeHtml === 'OFF') html = 'FUERA DE ANTENA';

    if (badgeHtml === 'SPORTS' || item.type === 'sports') {
        let parts = item.title.split('|'); let main = parts[0].trim(); let score = parts[1] ? `<br><span class="score-box">${parts[1].trim()}</span>` : '';
        el.title.innerHTML = main + score;
    } else { el.title.innerText = item.title; }

    el.sub.innerText = item.artist; el.badge.innerHTML = html; el.badge.className = badgeClass;
    if (item.img && el.img.src !== item.img) { el.img.src = item.img; }
}

function ejecutarAudio(item, seek, mode) {
    let safeMode = mode.toUpperCase();

    if (currentSourceUrl !== item.src) {
        currentSourceUrl = item.src; fadingDeck = activeDeck; activeDeck = (activeDeck === deckA) ? deckB : deckA;
        activeDeck.src = item.src; 
        
        let rt = Date.now() / 1000;
        let isStream = ['LIVE','ESTUDIO_LIVE','SPORTS','BREAKINGLIVE'].includes(safeMode);
        if (safeMode === 'WEATHER') playWeatherChime();

        activeDeck.onloadedmetadata = () => { 
            let adj = seek + ((Date.now() / 1000) - rt); 
            if (!isStream && adj > 2 && (!activeDeck.duration || adj < activeDeck.duration - 1)) {
                try { activeDeck.currentTime = adj; } catch(e) {}
            }
        };

        activeDeck.onended = () => { if (currentMode === 'WEATHER') playWeatherChime(); };
        
        activeDeck.oncanplay = () => { 
            isTransitioning = false; 
            currentFadeDur = (['NEWS', 'HOUR', 'BREAKING'].includes(safeMode)) ? 2.0 : (safeMode === 'NEWS30' ? 1.5 : CONFIG.crossfadeDur);
            fadeOutEndTime = (Date.now() / 1000) + currentFadeDur;
            safePlay(activeDeck); 
        };
        activeDeck.load();
        updateDisplay(item, safeMode, `status-badge ${item.type || safeMode.toLowerCase()}`);
    } else {
        let isStream = ['LIVE','ESTUDIO_LIVE','SPORTS','BREAKINGLIVE'].includes(safeMode);
        if (activeDeck.readyState >= 3 && !isStream) {
            if (Math.abs(activeDeck.currentTime - seek) > 15 && seek < activeDeck.duration - 1) {
                try { activeDeck.currentTime = seek; } catch(e) {}
            }
        }
        if (activeDeck.paused && systemOn && !isTransitioning) safePlay(activeDeck);
    }
}

function updateScheduleUI(tSpan = getSpainTime()) {
    let curSecs = tSpan.h * 3600 + tSpan.m * 60 + tSpan.s;
    let showsToday = (library.schedule[tSpan.d] || []).slice().sort((a, b) => a.startSecs - b.startSecs);
    let showsTomorrow = (library.schedule[(tSpan.d + 1) % 7] || []).slice().sort((a, b) => a.startSecs - b.startSecs);
    let upcoming = showsToday.filter(s => (s.startSecs + s.dur) > curSecs);
    let displayShows = upcoming.concat(showsTomorrow).slice(0, 3);
    
    let html = displayShows.length === 0 ? `<div class="schedule-item active"><span>Emisión Continuada</span><span class="time">--:--</span></div>` : '';
    displayShows.forEach((s, i) => {
        let title = s.title.split('|')[0].trim();
        let timeStr = String(Math.floor(s.startSecs / 3600)).padStart(2, '0') + ':' + String(Math.floor((s.startSecs % 3600) / 60)).padStart(2, '0');
        html += `<div class="schedule-item ${(i === 0 && curSecs >= s.startSecs) ? 'active' : ''}"><span>${title}</span><span class="time">${timeStr}</span></div>`;
    });
    el.sch.innerHTML = html;
}

initSystem();
