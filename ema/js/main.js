import {
  app, analytics, auth, db,
  signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword, sendPasswordResetEmail,
  collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy, limit, getDocs, where, writeBatch
} from './firebase.js';

  function addLog(type, message, unitId, incidentId, location) {
      const user = auth.currentUser ? auth.currentUser.email.split('@')[0] : 'Systeem';
      const logEntry = { id: 'LOG-' + Date.now() + '-' + Math.floor(Math.random()*1000), timestamp: new Date().toISOString(), type, message, unitId, incidentId, location, user };
      setDoc(doc(db, "logs", logEntry.id), logEntry).catch(e => console.warn(e));
  }
  
  function addIncidentAudit(incident, action, unitId = '') {
      const timeStr = new Date().getHours().toString().padStart(2,'0')+':'+new Date().getMinutes().toString().padStart(2,'0');
      incident.auditTrail = incident.auditTrail || [];
      const user = auth.currentUser ? auth.currentUser.email.split('@')[0] : 'Systeem';
      incident.auditTrail.push({ time: timeStr, action, user: user });
      
      let type = 'Notitie';
      const lowerAction = action.toLowerCase();
      if (lowerAction.includes('aangemaakt') || lowerAction.includes('toegevoegd')) type = 'Toegevoegd';
      else if (lowerAction.includes('gewijzigd') || lowerAction.includes('samengevoegd')) type = 'Wijziging';
      else if (lowerAction.includes('toegewezen') || lowerAction.includes('opschaling') || lowerAction.includes('status') || lowerAction.includes('uitgerukt')) type = 'Status';
      else if (lowerAction.includes('afgesloten')) type = 'Afloop';
      
      addLog(type, action, unitId, incident.id, incident.location);
  }

  async function seedDemoData() {
      try {
          const batch = writeBatch(db);
          DEMO_UNITS.forEach(unit => batch.set(doc(db, "units", unit.id), unit));
          DEMO_POSTS.forEach(post => batch.set(doc(db, "posts", post.id), post));
          DEMO_INCIDENTS.forEach(incident => batch.set(doc(db, "incidents", incident.id), incident));
          await batch.commit();
          showToast("Demo-gegevens hersteld!", false, 5000);
      } catch (e) {
          console.error("Fout bij toevoegen demo data:", e);
          showToast("Fout bij toevoegen demo data. Zie console.", true);
      }
  }

  // Verwijder bestaande eenheden/posten/meldingen en laad de demo-data opnieuw in
  async function reloadDemoData() {
      try {
          const deleteBatch = writeBatch(db);
          for (const collName of ['incidents', 'units', 'posts']) {
              const snap = await getDocs(collection(db, collName));
              snap.docs.forEach(d => deleteBatch.delete(d.ref));
          }
          await deleteBatch.commit();
          await seedDemoData();
      } catch (e) {
          console.error("Fout bij herladen demo-data:", e);
          showToast("Fout bij herladen demo-data. Zie console.", true);
      }
  }

  document.getElementById('reloadDemoDataBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      // Eerste klik: vraag om bevestiging via de knop zelf (confirm() wordt soms geblokkeerd)
      if (btn.dataset.confirm !== '1') {
          btn.dataset.confirm = '1';
          const orig = btn.textContent;
          btn.textContent = 'Klik nogmaals om te bevestigen (wist huidige data)';
          btn.style.borderColor = 'var(--red)';
          btn.style.color = 'var(--red)';
          setTimeout(() => {
              if (btn.dataset.confirm === '1') {
                  btn.dataset.confirm = '';
                  btn.textContent = orig;
                  btn.style.borderColor = '';
                  btn.style.color = '';
              }
          }, 4000);
          return;
      }
      btn.dataset.confirm = '';
      btn.style.borderColor = '';
      btn.style.color = '';
      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = 'Bezig met inladen...';
      showToast('Demo-gegevens worden ingeladen...');
      await reloadDemoData();
      btn.disabled = false;
      btn.textContent = oldText;
  });

  // ==========================================
  // 0A. LOGIN SCHERM LOGICA
  // ==========================================
  // --- DOM Elementen Caching ---
  const loginScreen = document.getElementById('loginScreen'),
        loginForm = document.getElementById('loginForm'),
        loginUsername = document.getElementById('loginUsername'),
        loginPassword = document.getElementById('loginPassword'),
        rememberMeCheckbox = document.getElementById('rememberMe'),
        forgotPasswordBtn = document.getElementById('forgotPasswordBtn'),
        themeToggle = document.getElementById('themeToggle'),
        htmlElement = document.documentElement,
        themeDarkBtn = document.getElementById('themeDarkBtn'),
        themeLightBtn = document.getElementById('themeLightBtn'),
        popoutBtn = document.getElementById('popoutBtn'),
        toggleRightPanelBtn = document.getElementById('toggleRightPanelBtn'),
        rightPanel = document.querySelector('.right'),
        panelOverlay = document.getElementById('panelOverlay'),
        linkToEenheden = document.getElementById('linkToEenheden'),
        linkToPosten = document.getElementById('linkToPosten'),
        actueleLoggingBody = document.getElementById('actueleLoggingBody'),
        liveLogSearchInput = document.getElementById('liveLogSearchInput'),
        liveLogTypeFilter = document.getElementById('liveLogTypeFilter'),
        liveLogUnitFilter = document.getElementById('liveLogUnitFilter'),
        logStartDate = document.getElementById('logStartDate'),
        logEndDate = document.getElementById('logEndDate'),
        loadMoreLogsBtn = document.getElementById('loadMoreLogsBtn'),
        weatherBtn = document.getElementById('weatherBtn'),
        exportCsvBtn = document.getElementById('exportCsvBtn'),
        printLogsBtn = document.getElementById('printLogsBtn'),
        changePasswordForm = document.getElementById('changePasswordForm'),
        btnBrandwacht = document.getElementById('btnBrandwacht'),
        btnLogistiek = document.getElementById('btnLogistiek'),
        addUnitForm = document.getElementById('addUnitForm'),
        showAddUnitFormBtn = document.getElementById('showAddUnitFormBtn'),
        showBulkAddUnitFormBtn = document.getElementById('showBulkAddUnitFormBtn'),
        showImportCsvFormBtn = document.getElementById('showImportCsvFormBtn'),
        importCsvFormSection = document.getElementById('importCsvFormSection'),
        unitFormSection = document.getElementById('unitFormSection'),
        unitTypeButtons = document.querySelectorAll('.unit-type-btn'),
        unitTypeInput = document.querySelector('input[name="soort"]'),
        cancelUnitFormBtn = document.getElementById('cancelUnitFormBtn'),
        cancelBulkAddUnitFormBtn = document.getElementById('cancelBulkAddUnitFormBtn'),
        bulkUnitFormSection = document.getElementById('bulkUnitFormSection'),
        bulkAddUnitForm = document.getElementById('bulkAddUnitForm');
  
  // Pre-fill email if it's stored in localStorage
  const savedEmail = localStorage.getItem('ema-email');
  if (savedEmail && loginUsername) {
    loginUsername.value = savedEmail;
  }

  let unsubIncidents, unsubUnits, unsubPosts, unsubLogs;
  let knownFbIncidentIds = new Set(), knownFbUnitIds = new Set(), knownFbPostIds = new Set();
  let globalLogs = [];
  let logLimit = 50;

  async function fetchAndRenderLogs() {
      if (unsubLogs) unsubLogs();

      const startDate = document.getElementById('logStartDate')?.value;
      const endDate = document.getElementById('logEndDate')?.value;

      let qConstraints = [orderBy("timestamp", "desc")];

      if (startDate) {
          qConstraints.push(where("timestamp", ">=", startDate + 'T00:00:00.000Z'));
      }
      if (endDate) {
          qConstraints.push(where("timestamp", "<=", endDate + 'T23:59:59.999Z'));
      }

      // If a date range is active, we don't limit. Otherwise, we use the incremental limit.
      if (!startDate && !endDate) {
          qConstraints.push(limit(logLimit));
      }

      const logQuery = query(collection(db, "logs"), ...qConstraints);

      unsubLogs = onSnapshot(logQuery, (snapshot) => {
          globalLogs = [];
          snapshot.forEach(doc => globalLogs.push(doc.data()));
          if (typeof renderGlobalLogs === 'function') renderGlobalLogs();
      }, (error) => {
          console.error("Fout bij ophalen logs:", error);
          if (error.code === 'failed-precondition') {
              showToast('Firebase index voor log-datums ontbreekt. Maak deze aan.', true, 10000);
              if(actueleLoggingBody) actueleLoggingBody.innerHTML = '<tr><td colspan="6" class="empty-table-msg" style="color:var(--amber);">⚠️ Firebase index ontbreekt. Kan niet op datum filteren. Ga naar de Firebase Console → Firestore → Indexen en maak een samengestelde index aan op <strong>logs</strong>: timestamp (DESC).</td></tr>';
          }
      });
  }

  // Check realtime of de gebruiker is ingelogd
  onAuthStateChanged(auth, async (user) => {
      if (user) {
          loginScreen.style.display = 'none';
          const accountEmailEl = document.getElementById('accountEmail');
          if (accountEmailEl) accountEmailEl.textContent = user.email;

          // Voorkom gestapelde listeners als onAuthStateChanged meermaals vuurt (token-refresh, meerdere tabs)
          if (unsubIncidents) unsubIncidents();
          if (unsubUnits) unsubUnits();
          if (unsubPosts) unsubPosts();
          if (unsubLogs) unsubLogs();

          unsubIncidents = onSnapshot(collection(db, "incidents"), (snapshot) => {
              // Merge: Firebase data heeft voorrang, lokale demo-data die niet in Firebase zit blijft staan
              const fbMap = {};
              snapshot.forEach(d => { fbMap[d.data().id] = d.data(); });
              // Vervang bekende ids, voeg nieuwe toe, verwijder ids die eerder wel in FB zaten maar nu weg zijn, houd echt lokale ids
              const fbIds = Object.keys(fbMap);
              incidents = incidents
                  .filter(i => !fbIds.includes(i.id) && !knownFbIncidentIds.has(i.id))
                  .concat(Object.values(fbMap));
              knownFbIncidentIds = new Set(fbIds);
              if (typeof renderTables === 'function') renderTables();
          });

          unsubUnits = onSnapshot(collection(db, "units"), (snapshot) => {
              const fbMap = {};
              snapshot.forEach(d => { fbMap[d.data().id] = d.data(); });
              const fbIds = Object.keys(fbMap);
              units = units
                  .filter(u => !fbIds.includes(u.id) && !knownFbUnitIds.has(u.id))
                  .concat(Object.values(fbMap));
              knownFbUnitIds = new Set(fbIds);
              if (typeof sortUnits === 'function') sortUnits(currentSort.col, true);
              if (typeof updateLiveLogUnitDropdown === 'function') updateLiveLogUnitDropdown();
          });

          unsubPosts = onSnapshot(collection(db, "posts"), (snapshot) => {
              const fbMap = {};
              snapshot.forEach(d => { fbMap[d.data().id] = d.data(); });
              const fbIds = Object.keys(fbMap);
              posts = posts
                  .filter(p => !fbIds.includes(p.id) && !knownFbPostIds.has(p.id))
                  .concat(Object.values(fbMap));
              knownFbPostIds = new Set(fbIds);
              if (typeof sortPosts === 'function') sortPosts(currentPostSort.col, true);
          });

          fetchAndRenderLogs();

          // Seed demo-data als Firebase leeg is
          const unitsSnap = await getDocs(query(collection(db, "units"), limit(1)));
          if (unitsSnap.empty) await seedDemoData();
      } else {
          loginScreen.style.display = 'flex';
          if (unsubIncidents) unsubIncidents();
          if (unsubUnits) unsubUnits();
          if (unsubPosts) unsubPosts();
          if (unsubLogs) unsubLogs();
      }
  });

  if (logStartDate) logStartDate.addEventListener('change', fetchAndRenderLogs);
  if (logEndDate) logEndDate.addEventListener('change', fetchAndRenderLogs);

  if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const email = loginUsername.value.trim();
          const password = loginPassword.value.trim();
          
          try {
              await signInWithEmailAndPassword(auth, email, password);
              if (rememberMeCheckbox.checked) {
                localStorage.setItem('ema-email', email); // Save email on successful login
              } else {
                localStorage.removeItem('ema-email'); // Remove email if not checked
              }
              showToast('Succesvol ingelogd');
              loginForm.reset();
          } catch (error) {
              console.error("Fout bij inloggen:", error);
              showToast('Inloggen mislukt. Controleer je gegevens.', true);
          }
      });
  }

  // ==========================================
  // 0. DONKER/LICHT MODUS TOGGLE
  // ==========================================

  // Laad opgeslagen theme voorkeur, standaard is lichte modus
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'light') {
      htmlElement.classList.add('light-mode');
  }

  function updateThemeButtons() {
      if (!themeDarkBtn || !themeLightBtn) return;
      if (htmlElement.classList.contains('light-mode')) {
          themeLightBtn.classList.add('active');
          themeDarkBtn.classList.remove('active');
      } else {
          themeDarkBtn.classList.add('active');
          themeLightBtn.classList.remove('active');
      }
  }
  updateThemeButtons();

  // Toggle functie
  if (themeToggle) {
      themeToggle.addEventListener('click', () => {
          htmlElement.classList.toggle('light-mode');
          const currentTheme = htmlElement.classList.contains('light-mode') ? 'light' : 'dark';
          localStorage.setItem('theme', currentTheme);
          updateThemeButtons();
      });
  }
  
  if (themeDarkBtn) {
      themeDarkBtn.addEventListener('click', () => {
          htmlElement.classList.remove('light-mode');
          localStorage.setItem('theme', 'dark');
          updateThemeButtons();
      });
  }
  if (themeLightBtn) {
      themeLightBtn.addEventListener('click', () => {
          htmlElement.classList.add('light-mode');
          localStorage.setItem('theme', 'light');
          updateThemeButtons();
      });
  }
  
  // ==========================================
  // POPOUT & MOBILE SIDEBAR LOGICA
  // ==========================================
  const urlParams = new URLSearchParams(window.location.search);
  const isPopout = urlParams.get('popout') === 'true';

  if (isPopout) {
      // Hide all main interface elements for any popout
      document.querySelector('.topbar').style.display = 'none';
      document.querySelector('.nav').style.display = 'none';
      document.querySelector('.actions').style.display = 'none';
      document.querySelector('.left-container').style.display = 'none';
      document.querySelector('.body').style.gridTemplateColumns = '1fr';
      document.querySelector('.body').style.height = '100vh';

      // Check which panel to show
      if (urlParams.get('panel') === 'weather') {
          document.querySelector('.right').style.display = 'none'; // Hide the units panel
          document.getElementById('weatherModal').classList.add('show');
          const weatherContent = document.querySelector('#weatherModal .modal-content');
          weatherContent.style.width = '100%';
          weatherContent.style.height = '100vh';
          weatherContent.style.borderRadius = '0';
          weatherContent.style.maxWidth = 'none';
          document.getElementById('weatherPopoutBtn').style.display = 'none';
          document.getElementById('weatherCloseBtn').style.display = 'none';
          // Trigger weather data load
          fetchWeatherData(52.09, 5.12, true); // Use fallback location for popout
      } else { // Default to units panel popout
          document.querySelector('.right').style.display = 'flex'; // Make sure it's visible
          document.querySelector('.right').style.width = '100%';
          document.querySelector('.right').style.height = '100vh';
          document.querySelector('.right').style.border = 'none';
          document.querySelector('.right').style.position = 'relative';
          document.querySelector('.right').style.right = '0';
          document.querySelector('.right').style.overflowY = 'auto';
          document.querySelectorAll('.rp-header').forEach(h => h.style.top = '0');
          document.getElementById('popoutBtn').style.display = 'none';
      }
  }

  if (popoutBtn && !isPopout) {
      popoutBtn.addEventListener('click', () => {
          window.open(window.location.pathname + '?popout=true', 'EenhedenPanel', 'width=380,height=800,left=1000,top=100');
          document.querySelector('.right').style.display = 'none';
          document.querySelector('.body').style.gridTemplateColumns = '1fr';
          showToast('Eenheden paneel geopend in nieuw venster. Herlaad de pagina om hem weer vast te zetten.');
      });
  }

  if (toggleRightPanelBtn && rightPanel && panelOverlay) {
      toggleRightPanelBtn.addEventListener('click', () => {
          rightPanel.classList.toggle('show-panel');
          panelOverlay.classList.toggle('show');
      });
      panelOverlay.addEventListener('click', () => {
          rightPanel.classList.remove('show-panel');
          panelOverlay.classList.remove('show');
      });
  }

  // ==========================================
  // SNELKOPPELING NAAR EENHEDEN
  // ==========================================
  if (linkToEenheden) {
      linkToEenheden.addEventListener('click', () => {
          const eenhedenNavBtn = document.querySelector('.nav-btn[data-target="view-eenheden"]');
          if (eenhedenNavBtn && !isPopout) eenhedenNavBtn.click();
      });
  }
  if (linkToPosten) {
      linkToPosten.addEventListener('click', () => {
          const postenNavBtn = document.querySelector('.nav-btn[data-target="view-posten"]');
          if (postenNavBtn && !isPopout) postenNavBtn.click();
      });
  }

  // ==========================================
  // 1. DE JAVASCRIPT DATABASES (Geheugen)
  // ==========================================
  
  // Demo-data als standaard startwaarden (worden overschreven door Firebase zodra data binnenkomt)
  const DEMO_UNITS = [
      { id: 'BLS-01', type: 'BLS', location: 'Tribune West', naam1: 'Jan de Vries', naam2: 'Eva Bakker', naam3: '', status: 'uitgerukt', gekoppeldAanPost: 'Post Noord', ondersteunend: false, ipadnr: 'iPad-01', tasnummer: 'Tas-A', radioId: '101' },
      { id: 'BLS-02', type: 'BLS', location: 'Post Zuid', naam1: 'Piet Jansen', naam2: 'Klaas de Wit', naam3: '', status: 'op post', gekoppeldAanPost: 'Post Zuid', ondersteunend: false, ipadnr: 'iPad-02', tasnummer: 'Tas-B', radioId: '102' },
      { id: 'BLS-03', type: 'BLS', location: 'Post Oost', naam1: 'Sanne Vermeer', naam2: 'Tom Hendriks', naam3: '', status: 'inzetbaar', gekoppeldAanPost: 'Post Oost', ondersteunend: false, ipadnr: 'iPad-05', tasnummer: 'Tas-E', radioId: '103' },
      { id: 'ALS-01', type: 'ALS', location: 'Podium A', naam1: 'Dr. Smits', naam2: 'Vpk. de Boer', naam3: '', status: 'uitgerukt', gekoppeldAanPost: 'Post Noord', ondersteunend: false, ipadnr: 'iPad-03', tasnummer: 'Tas-C', radioId: '201' },
      { id: 'ALS-02', type: 'ALS', location: 'Post Zuid', naam1: 'Dr. Visser', naam2: 'Vpk. Janssen', naam3: '', status: 'pauze', gekoppeldAanPost: 'Post Zuid', ondersteunend: false, ipadnr: 'iPad-04', tasnummer: 'Tas-D', radioId: '202' },
      { id: 'BV-01', type: 'BLS vervoer', location: 'Post Noord', naam1: 'Ramon Koster', naam2: 'Lisa Mol', naam3: '', status: 'inzetbaar', gekoppeldAanPost: 'Post Noord', ondersteunend: false, ipadnr: 'iPad-06', tasnummer: 'Tas-F', radioId: '301' },
      { id: 'AV-01', type: 'ALS vervoer', location: 'Post Zuid', naam1: 'Dr. Peters', naam2: 'Vpk. Aydin', naam3: '', status: 'inzetbaar', gekoppeldAanPost: 'Post Zuid', ondersteunend: false, ipadnr: 'iPad-07', tasnummer: 'Tas-G', radioId: '302' },
      { id: 'RB-01', type: 'Reddingsbrigade', location: 'Strandzone', naam1: 'Mark de Groot', naam2: 'Iris Bos', naam3: '', status: 'op post', gekoppeldAanPost: 'Post Oost', ondersteunend: false, ipadnr: 'iPad-08', tasnummer: 'Tas-H', radioId: '401' },
      { id: 'BW-01', type: 'Brandwacht', location: 'Backstage', naam1: 'Henk Mulder', naam2: '', naam3: '', status: 'uitgerukt', gekoppeldAanPost: 'Post Noord', ondersteunend: false, ipadnr: 'iPad-09', tasnummer: 'Tas-I', radioId: '501' },
      { id: 'OND-01', type: 'Ondersteunend', location: 'Post Noord', naam1: 'Karin Smit', naam2: '', naam3: '', status: 'uitgerukt', gekoppeldAanPost: 'Post Noord', ondersteunend: true, ipadnr: 'iPad-10', tasnummer: 'Tas-J', radioId: '601' }
  ];
  const DEMO_POSTS = [
      { id: 'P-1', naam: 'Post Noord', locatie: 'Evenemententerrein Noord', postcoordinator: 'Coördinator Noord', status: 'open' },
      { id: 'P-2', naam: 'Post Zuid', locatie: 'Hoofdingang', postcoordinator: 'Coördinator Zuid', status: 'open' },
      { id: 'P-3', naam: 'Post Oost', locatie: 'Camping / Strandzone', postcoordinator: 'Coördinator Oost', status: 'open' },
      { id: 'P-4', naam: 'EHBO Hoofdpodium', locatie: 'Naast Podium A', postcoordinator: 'Hoofd EHBO', status: 'gesloten' }
  ];
  const DEMO_INCIDENTS = [
      { id: 'M-1', status: 'Nieuw', time: '10:30', location: 'Podium A', event: 'Onwelwording', reporter: 'Bezoeker', urgency: 'Spoed', units: [], details: { gender: 'Vrouw', age: '24' }, auditTrail: [{ time: '10:30', action: 'Aangemaakt - Spoed', user: 'Systeem' }] },
      { id: 'M-2', status: 'Nieuw', time: '10:48', location: 'Ingang Oost', event: 'Snijwond aan hand', reporter: 'Beveiliger Oost', urgency: 'Uitstelmogelijkheid', units: [], details: { gender: 'Man', age: '37' }, auditTrail: [{ time: '10:48', action: 'Aangemaakt - Uitstelmogelijkheid', user: 'Systeem' }] },
      { id: 'M-3', status: 'Toegewezen', time: '10:35', location: 'Tribune West', event: 'Valpartij, hoofdwond', reporter: 'Beveiliging', urgency: 'Direct Vertrekken', units: ['BLS-01'], details: { gender: 'Man', age: '52' }, auditTrail: [{ time: '10:35', action: 'Aangemaakt - Direct Vertrekken', user: 'Systeem' }, { time: '10:36', action: 'Eenheid toegewezen: BLS-01', user: 'Systeem' }] },
      { id: 'M-4', status: 'Toegewezen', time: '10:52', location: 'Podium A', event: 'Reanimatie (SBAR)', reporter: 'EHBO post', urgency: 'Spoed', units: ['ALS-01'], details: { phone: '06-12345678', age: '61', gender: 'Man', participantNumber: 'D-2045', careContactNumber: 'ZC-118', airway: 'Vrij', breathing: 'Geen ademhaling', circulation: 'Geen pols', disability: 'U - Unresponsive', exposure: 'Geen letsel zichtbaar', background: 'Bekend met hartklachten, gebruikt bloedverdunners.', assessment: 'Vermoedelijk hartstilstand, reanimatie gestart door omstanders.', recommendations: ['Ambulance', 'Arts'] }, auditTrail: [{ time: '10:52', action: 'Aangemaakt (SBAR) - Spoed', user: 'Systeem' }, { time: '10:53', action: 'Eenheid toegewezen: ALS-01', user: 'Systeem' }] },
      { id: 'B-1', status: 'Toegewezen', time: '11:05', location: 'Backstage', event: 'Brandwacht: rookontwikkeling generator', reporter: 'Productieleider', urgency: 'Direct Vertrekken', units: ['BW-01'], details: {}, auditTrail: [{ time: '11:05', action: 'Brandwacht melding aangemaakt - Direct Vertrekken', user: 'Systeem' }, { time: '11:06', action: 'Eenheid toegewezen: BW-01', user: 'Systeem' }] },
      { id: 'L-1', status: 'Aangevraagd', time: '10:40', location: 'Post Noord', event: 'Water bijvullen', reporter: 'Postcoördinator', urgency: 'Normaal', units: [], details: {}, auditTrail: [{ time: '10:40', action: 'Logistieke melding aangemaakt - Normaal', user: 'Systeem' }] },
      { id: 'L-2', status: 'Aangevraagd', time: '11:10', location: 'Post Zuid', event: 'Verbandmiddelen aanvullen', reporter: 'Coördinator Zuid', urgency: 'Laag', units: [], details: {}, auditTrail: [{ time: '11:10', action: 'Logistieke melding aangemaakt - Laag', user: 'Systeem' }] },
      { id: 'M-5', status: 'Afgesloten - Zorg ter plaatse', time: '09:58', location: 'Camping veld C', event: 'Insectensteek, allergische reactie', reporter: 'Kampeerder', urgency: 'Spoed', units: ['BLS-02'], details: { gender: 'Vrouw', age: '29' }, auditTrail: [{ time: '09:58', action: 'Aangemaakt - Spoed', user: 'Systeem' }, { time: '09:59', action: 'Eenheid toegewezen: BLS-02', user: 'Systeem' }, { time: '10:20', action: 'Afgesloten - Zorg ter plaatse', user: 'Systeem' }] }
  ];

  let incidents = DEMO_INCIDENTS.map(i => ({...i}));
  let units = DEMO_UNITS.map(u => ({...u}));
  let posts = DEMO_POSTS.map(p => ({...p}));

  // ==========================================
  // 1B. GLOBAAL LIVE LOGBOEK & TIJDLIJN PER EENHEID
  // ==========================================

  function getLogTypeStyle(type) {
      type = (type || '').toLowerCase();
      if (type.includes('status') || type.includes('uitgerukt')) return { bg: 'var(--blue-bg)', color: 'var(--blue)' };
      if (type.includes('wijziging')) return { bg: 'var(--amber-bg)', color: 'var(--amber)' };
      if (type.includes('toegevoegd') || type.includes('nieuw')) return { bg: 'var(--green-bg)', color: 'var(--green)' };
      if (type.includes('afloop')) return { bg: 'var(--bg3)', color: 'var(--text3)' };
      return { bg: 'var(--purple-bg)', color: 'var(--purple)' };
  }

  function updateLiveLogUnitDropdown() {
      const select = document.getElementById('liveLogUnitFilter');
      if (!select) return;
      const currentVal = select.value;
      let html = '<option value="">Alle eenheden</option>';
      
      const sortedUnits = [...units].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      sortedUnits.forEach(u => {
          html += `<option value="${u.id}">${u.id}</option>`;
      });
      
      select.innerHTML = html;
      if (units.find(u => u.id === currentVal)) {
          select.value = currentVal;
      }
  }

  function renderGlobalLogs() {
      if (!actueleLoggingBody) return;
      
      if (globalLogs.length === 0) {
          actueleLoggingBody.innerHTML = '<tr><td colspan="6" class="empty-table-msg">Geen logs gevonden voor de geselecteerde criteria.</td></tr>';
          if (loadMoreLogsBtn) loadMoreLogsBtn.style.display = 'none';
          return;
      }
      
      const searchQ = (document.getElementById('liveLogSearchInput')?.value || '').toLowerCase();
      const typeQ = document.getElementById('liveLogTypeFilter')?.value;
      const unitQ = document.getElementById('liveLogUnitFilter')?.value;

      let filteredLogs = globalLogs;

      if (searchQ) {
          filteredLogs = filteredLogs.filter(log => 
              (log.message || '').toLowerCase().includes(searchQ) ||
              (log.incidentId || '').toLowerCase().includes(searchQ) ||
              (log.user || '').toLowerCase().includes(searchQ)
          );
      }
      
      if (typeQ) {
          filteredLogs = filteredLogs.filter(log => {
              if (typeQ === 'Notitie') return (log.type || '').includes('Notitie') || (log.type || '').includes('Nader bericht');
              return log.type === typeQ;
          });
      }
      
      if (unitQ) {
          filteredLogs = filteredLogs.filter(log => log.unitId === unitQ);
      }

      if (filteredLogs.length === 0) {
          actueleLoggingBody.innerHTML = '<tr><td colspan="6" class="empty-table-msg">Geen logs gevonden met huidige filters.</td></tr>';
          if (loadMoreLogsBtn) loadMoreLogsBtn.style.display = 'none';
          return;
      }

      actueleLoggingBody.innerHTML = filteredLogs.map(log => {
          const d = new Date(log.timestamp);
          const timeStr = d.toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit'}) + ' ' + d.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
          const style = getLogTypeStyle(log.type);
          const typePill = `<span class="pill" style="background:${style.bg}; color:${style.color}; border:1px solid ${style.color};">${log.type || 'Systeem'}</span>`;
          
          const incidentLink = log.incidentId ? `<a href="#" class="log-incident-link" data-id="${log.incidentId}" style="color:var(--blue); font-weight:600; text-decoration:none;">${log.incidentId}</a>` : '-';
          const unitLink = log.unitId ? `<a href="#" class="log-unit-link" data-id="${log.unitId}" style="color:var(--text1); font-weight:600; text-decoration:none;">${log.unitId}</a>` : '-';

          return `
              <tr>
                  <td style="color:var(--text3); font-size:11px;">${timeStr}</td>
                  <td>${typePill}</td>
                  <td>${incidentLink}</td>
                  <td>${unitLink}</td>
                  <td style="white-space:normal;">${log.message}</td>
                  <td><span style="color:var(--text2); font-size:12px;">${log.user || 'Systeem'}</span></td>
              </tr>
          `;
      }).join('');

      if (loadMoreLogsBtn) {
          const startDate = document.getElementById('logStartDate')?.value;
          const endDate = document.getElementById('logEndDate')?.value;
          if (startDate || endDate) {
              loadMoreLogsBtn.style.display = 'none';
          } else {
              if (globalLogs.length < logLimit) loadMoreLogsBtn.style.display = 'none';
              else { loadMoreLogsBtn.style.display = 'block'; loadMoreLogsBtn.innerText = 'Laad meer logs...'; }
          }
      }
  }

  function loadMoreLogs() {
      if (unsubLogs) unsubLogs();
      unsubLogs = null;
      logLimit += 50;
      fetchAndRenderLogs();
  }

  const wrapper = document.getElementById('actueleLoggingWrapper');
  if (wrapper) {
      wrapper.addEventListener('scroll', () => {
          if (wrapper.scrollTop + wrapper.clientHeight >= wrapper.scrollHeight - 10) {
              if (loadMoreLogsBtn && loadMoreLogsBtn.style.display !== 'none' && loadMoreLogsBtn.innerText !== 'Laden...') {
                  loadMoreLogsBtn.innerText = 'Laden...';
                  loadMoreLogs();
              }
          }
      });
  }

  // Debounce function to prevent excessive function calls on input
  function debounce(func, delay) {
      let timeout;
      return function(...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => func.apply(this, args), delay);
      };
  }

  const debouncedRenderGlobalLogs = debounce(renderGlobalLogs, 300);

  loadMoreLogsBtn?.addEventListener('click', loadMoreLogs);
  liveLogSearchInput?.addEventListener('input', debouncedRenderGlobalLogs);
  liveLogTypeFilter?.addEventListener('change', renderGlobalLogs);
  liveLogUnitFilter?.addEventListener('change', renderGlobalLogs);
  
  exportCsvBtn?.addEventListener('click', () => {
      const rows = [['Datum/Tijd', 'Soort', 'Melding', 'Eenheid', 'Bericht/Notitie', 'Gebruiker']];
      if (!actueleLoggingBody) return;
      Array.from(actueleLoggingBody.querySelectorAll('tr')).forEach(tr => {
          if (tr.querySelector('.empty-table-msg')) return;
          const cols = Array.from(tr.querySelectorAll('td')).map(td => `"${(td.innerText || td.textContent).replace(/"/g, '""')}"`);
          rows.push(cols.join(','));
      });
      const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + rows.join('\n');
      const link = document.createElement("a");
      link.setAttribute("href", encodeURI(csvContent));
      link.setAttribute("download", `logboek_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
  });

  printLogsBtn?.addEventListener('click', () => {
      const printWin = window.open('', '_blank');
      const tableHtml = document.getElementById('actueleLoggingWrapper').querySelector('table').outerHTML;
      printWin.document.write(`
          <html><head><title>Logboek Export</title>
          <style>body{font-family:Arial,sans-serif;padding:20px;color:#333;} h2{color:#111;border-bottom:1px solid #ccc;padding-bottom:10px;} table{width:100%;border-collapse:collapse;font-size:12px;margin-top:20px;} th,td{border:1px solid #ddd;padding:8px;text-align:left;} th{background-color:#f5f5f5;font-weight:bold;} a{text-decoration:none;color:inherit;}</style>
          </head><body>
          <h2>Globaal Logboek Export - ${new Date().toLocaleString('nl-NL')}</h2>
          ${tableHtml}
          <script>setTimeout(() => { window.print(); window.close(); }, 300);<\/script>
          </body></html>
      `);
      printWin.document.close();
  });

  document.addEventListener('click', (e) => {
      if (e.target.classList.contains('log-incident-link')) {
          e.preventDefault();
          openTimelineModal(e.target.getAttribute('data-id'));
      }
      if (e.target.classList.contains('log-unit-link')) {
          e.preventDefault();
          openUnitTimelineModal(e.target.getAttribute('data-id'));
      }
  });

  async function openUnitTimelineModal(unitId) {
      document.getElementById('unitTimelineUnitId').innerText = unitId;
      const content = document.getElementById('unitTimelineContent');
      content.innerHTML = '<div style="text-align:center; color:var(--text3); padding: 20px;">Gegevens laden uit Firebase...</div>';
      document.getElementById('unitTimelineModal').classList.add('show');
      try {
          const q = query(collection(db, "logs"), where("unitId", "==", unitId), orderBy("timestamp", "desc"));
          const snap = await getDocs(q);
          const unitLogs = [];
          snap.forEach(d => unitLogs.push(d.data()));
          if (unitLogs.length === 0) { content.innerHTML = '<div class="empty-table-msg">Geen tijdlijn gegevens beschikbaar voor deze eenheid.</div>'; return; }
          let html = '<div class="timeline-container">';
          unitLogs.forEach(entry => {
              const d = new Date(entry.timestamp);
              const timeStr = d.toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit'}) + ' ' + d.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit'});
              const userStr = entry.user ? `<div class="timeline-user"><svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;margin-right:4px;"><circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/></svg>${entry.user}</div>` : '';
              const incStr = entry.incidentId ? `<div style="font-size:11px; color:var(--blue); margin-bottom:2px;">Melding: ${entry.incidentId}</div>` : '';
              html += `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><div class="timeline-time">${timeStr}</div>${incStr}<div class="timeline-action">${entry.message}</div>${userStr}</div></div>`;
          });
          html += '</div>';
          content.innerHTML = html;
      } catch(e) {
          content.innerHTML = '<div class="empty-table-msg" style="color:var(--amber);">⚠️ Firebase index ontbreekt. Ga naar de Firebase Console → Firestore → Indexen en maak een samengestelde index aan op <strong>logs</strong>: unitId (ASC) + timestamp (DESC).</div>';
      }
  }
  document.getElementById('unitTimelineCloseBtn')?.addEventListener('click', () => document.getElementById('unitTimelineModal').classList.remove('show'));

  // ==========================================
  // 2. RENDERING FUNCTIES (Tekenen op het scherm)
  // ==========================================

  function getStatusStyle(status) {
      status = (status || '').toLowerCase();
      // Groen voor inzetbaar of op post, alles anders rood
      if (['inzetbaar', 'op post'].includes(status)) return { bg: 'us-g', dot: 'g' };
      return { bg: 'us-r', dot: 'r' };
  }

  function getPostStatusStyle(status) {
      status = (status || '').toLowerCase();
      if (['open'].includes(status)) return { bg: 'us-g', dot: 'g' };
      return { bg: 'us-r', dot: 'r' }; // gesloten
  }

    // Non-blocking toast helper
    function showToast(message, isError = false, timeout = 3000) {
      const container = document.getElementById('toastContainer');
      if (!container) return console.warn('Toast container not found');
      const el = document.createElement('div');
      el.className = 'inline-toast' + (isError ? ' error' : '');
      el.textContent = message;
      container.appendChild(el);
      setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = '0'; setTimeout(()=> el.remove(), 260); }, timeout);
    }

  function assignUnitToIncidentByDrag(unitId, incidentId) {
      const unit = units.find(u => u.id === unitId);
      const incident = incidents.find(i => i.id === incidentId);

      if (!unit || !incident) return;

      // Controleer of de eenheid al is toegewezen aan deze specifieke melding
      if (incident.units && incident.units.some(u => u === unit.id || u.endsWith(': ' + unit.id))) {
          showToast(`Eenheid ${unit.id} is al gekoppeld aan deze melding.`, true);
          return;
      }

      incident.units = incident.units || [];
      const isOpschaling = incident.units.length > 0;
      const label = isOpschaling ? `Opschaling: ${unit.id}` : unit.id;
      
      incident.units.push(label);
      incident.status = isOpschaling ? 'Opschaling' : 'Toegewezen';
      
      unit.status = 'uitgerukt';
      unit.location = incident.location;
      
      addIncidentAudit(incident, `Eenheid toegewezen: ${label}`, unit.id);
      
      setDoc(doc(db, "units", unit.id), unit);
      setDoc(doc(db, "incidents", incident.id), incident);
      
      renderTables();
      renderUnits();
      if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
      
      showToast(`Eenheid ${unit.id} succesvol ${isOpschaling ? 'toegevoegd als opschaling' : 'toegewezen'}.`);
  }

  function makeRowDropTarget(tr, incidentId) {
      tr.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          tr.classList.add('drag-over');
      });
      tr.addEventListener('dragenter', (e) => {
          e.preventDefault();
          tr.classList.add('drag-over');
      });
      tr.addEventListener('dragleave', (e) => {
          if (!tr.contains(e.relatedTarget)) {
              tr.classList.remove('drag-over');
          }
      });
      tr.addEventListener('drop', (e) => {
          e.preventDefault();
          tr.classList.remove('drag-over');
          const unitId = e.dataTransfer.getData('text/plain');
          if (unitId) assignUnitToIncidentByDrag(unitId, incidentId);
      });
  }

  function renderUnits() {
    const container = document.getElementById('rightPanelUnits');
    if (!container) return;
    container.innerHTML = '';

    let operationalUnits = units.filter(u => u.status !== 'uitgemeld');
    if (operationalUnits.length === 0) {
        container.innerHTML = '<div class="empty-table-msg" style="padding:16px;">Geen operationele eenheden beschikbaar</div>';
        return;
    }
    
    // Sorteer op status: Inzetbaar en Retour post bovenaan
    const statusOrder = {
        'inzetbaar': 1,
        'retour post': 2,
        'op post': 3,
        'pauze': 4,
        'uitgerukt': 5
    };
    
    operationalUnits.sort((a, b) => {
        const orderA = statusOrder[a.status] || 99;
        const orderB = statusOrder[b.status] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.id.localeCompare(b.id);
    });

    operationalUnits.forEach((u) => {
        const style = getStatusStyle(u.status);
        const isDraggable = (u.status !== 'uitgemeld' && u.status !== 'uitgerukt');

        const row = document.createElement('div');
        row.className = 'unit-row';
        if (isDraggable) {
            row.draggable = true;
            row.setAttribute('data-drag-unit', u.id);
            row.style.cursor = 'grab';
        }

        row.innerHTML = `
            <div class="unit-left">
                <span class="unit-dot ${style.dot}"></span>
                <div>
                    <div>
                        <a href="#" class="unit-name log-unit-link" data-id="${u.id}" style="text-decoration:none; cursor:pointer;">${u.id}</a>
                        <span class="unit-type">${u.type}</span>
                    </div>
                    <div class="unit-loc">Locatie: ${u.location}</div>
                </div>
            </div>
            <select class="status-dropdown-base unit-status-select ${style.bg}">
                <option value="uitgerukt"   ${u.status === 'uitgerukt'    ? 'selected' : ''}>uitgerukt</option>
                <option value="vertrek patiënt" ${u.status === 'vertrek patiënt' ? 'selected' : ''}>vertrek patiënt</option>
                <option value="inzetbaar"   ${u.status === 'inzetbaar'    ? 'selected' : ''}>inzetbaar</option>
                <option value="retour post" ${u.status === 'retour post'  ? 'selected' : ''}>retour post</option>
                <option value="op post"     ${u.status === 'op post'      ? 'selected' : ''}>op post</option>
                <option value="pauze"       ${u.status === 'pauze'        ? 'selected' : ''}>pauze</option>
                <option value="uitgemeld"   ${u.status === 'uitgemeld'    ? 'selected' : ''}>uitgemeld</option>
            </select>
        `;

        // ✅ FIX 2: Zoek op ID, niet op index
        row.querySelector('.unit-status-select').addEventListener('change', (e) => {
            const unitIndex = units.findIndex(x => x.id === u.id);
            if (unitIndex !== -1) {
                const newStatus = e.target.value;
                units[unitIndex].status = newStatus;
                
                // Update locatie naar gekoppelde post bij 'retour post' of 'op post'
                if ((newStatus === 'retour post' || newStatus === 'op post') && units[unitIndex].gekoppeldAanPost) {
                    units[unitIndex].location = units[unitIndex].gekoppeldAanPost;
                }
                
                setDoc(doc(db, "units", u.id), units[unitIndex]);
                addLog('Status', `Status gewijzigd naar: ${newStatus}`, u.id, '', units[unitIndex].location);
            }
            // ✅ FIX 1: renderUnits wordt maar 1x aangeroepen
            renderUnits();
            renderTables();
            if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
        });

        // Drag events direct op de row, niet via querySelectorAll achteraf
        if (isDraggable) {
            row.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', u.id);
                e.dataTransfer.effectAllowed = 'copyMove';
            });
        }

        container.appendChild(row);
    });
  }

  function renderPosts() {
      const container = document.getElementById('rightPanelPosts');
      if (!container) return;
      container.innerHTML = ''; 
      if (posts.length === 0) {
          container.innerHTML = '<div class="empty-table-msg" style="padding:16px;">Geen posten geregistreerd</div>';
          return;
      }
      posts.forEach((p) => {
          const style = getPostStatusStyle(p.status);
          const row = document.createElement('div');
          row.className = 'unit-row';
          row.innerHTML = `
            <div class="unit-left"><span class="unit-dot ${style.dot}"></span><div><div class="unit-name">${p.naam}</div><div class="unit-loc">Locatie: ${p.locatie || '-'}</div></div></div>
            <span class="status-dropdown-base ${style.bg}" data-id="${p.id}" title="Klik om te wisselen" style="cursor:pointer;user-select:none;">${p.status}</span>
          `;
          row.querySelector(`[data-id="${p.id}"]`).addEventListener('click', () => {
              const postIndex = posts.findIndex(x => x.id === p.id);
              if (postIndex !== -1) {
                  posts[postIndex].status = posts[postIndex].status === 'open' ? 'gesloten' : 'open';
                  setDoc(doc(db, "posts", posts[postIndex].id), posts[postIndex]);
                  renderPosts();
                  if (typeof renderDetailedPostsTable === 'function') renderDetailedPostsTable();
              }
          });
          container.appendChild(row);
      });
  }

  // Toggle visibility of the header action buttons in the 'Lopende Meldingen' dashboard
  function updateHeaderButtonsVisibility() {
      const actions = document.querySelector('#view-home .section-actions');
      if (!actions) return;
      const activeCount = incidents.filter(i => !i.status.startsWith('Afgesloten')).length;
      actions.style.display = activeCount > 0 ? 'flex' : 'none';
  }

  function renderTables() {
      const newTable = document.getElementById('newIncidentsTable');
      const homeTable = document.getElementById('homeIncidentsTable');
      const allTable = document.getElementById('allIncidentsTable');
      
      if (newTable) newTable.innerHTML = '';
      homeTable.innerHTML = '';
      allTable.innerHTML = '';

      const activeIncidents = incidents.filter(inc => !inc.status.startsWith('Afgesloten'));
      let closedIncidents = incidents.filter(inc => inc.status.startsWith('Afgesloten'));

      const isLogistiek = inc => inc.id && inc.id.startsWith('L-');
      const operationeelActief = activeIncidents.filter(inc => !isLogistiek(inc));
      const logistiekActief = activeIncidents.filter(isLogistiek);

      const newIncidents = operationeelActief.filter(inc => !inc.units || inc.units.length === 0);
      const assignedIncidents = operationeelActief.filter(inc => inc.units && inc.units.length > 0);

      // Nieuwe meldingen (zonder eenheid)
      if (newTable) {
          if (newIncidents.length === 0) {
              newTable.innerHTML = `<tr><td colspan="8" class="empty-table-msg">Geen nieuwe meldingen...</td></tr>`;
          } else {
              newIncidents.forEach(inc => {
                  const assignedUnits = '-';
                  const trNew = document.createElement('tr');
              makeRowDropTarget(trNew, inc.id);
                  trNew.innerHTML = `
                    <td><span class="pill pill-on">${inc.status}</span></td>
                    <td class="col-time" style="color:var(--text3);font-size:11px">${inc.time}</td>
                    <td><span class="editable-incident-field" data-id="${inc.id}" data-field="location" title="Klik om te bewerken">${inc.location || '<i>Onbekend</i>'}</span></td>
                    <td><span class="editable-incident-field" data-id="${inc.id}" data-field="event" title="Klik om te bewerken">${inc.event || '<i>Onbekend</i>'}</span></td>
                    <td><span class="editable-incident-field" data-id="${inc.id}" data-field="reporter" title="Klik om te bewerken">${inc.reporter || '<i>Onbekend</i>'}</span></td>
                    <td><span class="urgency-badge" data-action="urgentie" data-id="${inc.id}" title="Klik om urgentie te wijzigen" style="color:var(--amber);font-weight:600;cursor:pointer;text-decoration:underline dotted;">${inc.urgency}</span></td>
                    <td><span style="color:var(--blue);font-weight:600;">${assignedUnits}</span></td>
                    <td>
                      <div class="row-actions">
                        <button type="button" class="btn btn-outline" data-action="toewijzen" data-id="${inc.id}">Toewijzen</button>
                        <button type="button" class="btn btn-outline" data-action="log" data-id="${inc.id}">Log</button>
                        <button type="button" class="btn btn-outline" data-action="samenvoegen" data-id="${inc.id}">Samenvoegen</button>
                        <button type="button" class="btn btn-outline" data-action="afsluiten" data-id="${inc.id}">Statusen</button>
                      </div>
                    </td>
                  `;
                  newTable.appendChild(trNew);
              });
          }
      }

      // Lopende meldingen (met eenheid)
      if (assignedIncidents.length === 0) {
          homeTable.innerHTML = `<tr><td colspan="8" class="empty-table-msg">Geen toegewezen meldingen...</td></tr>`;
      } else {
          assignedIncidents.forEach(inc => {
              const assignedUnits = (inc.units && inc.units.length) ? inc.units.join('<br>') : (inc.unit ? inc.unit : '-');
              const trHome = document.createElement('tr');
          makeRowDropTarget(trHome, inc.id);
              trHome.innerHTML = `
                <td><span class="pill pill-on">${inc.status}</span></td>
                <td class="col-time" style="color:var(--text3);font-size:11px">${inc.time}</td>
                <td><span class="editable-incident-field" data-id="${inc.id}" data-field="location" title="Klik om te bewerken">${inc.location || '<i>Onbekend</i>'}</span></td>
                <td><span class="editable-incident-field" data-id="${inc.id}" data-field="event" title="Klik om te bewerken">${inc.event || '<i>Onbekend</i>'}</span></td>
                <td>${inc.reporter}</td>
                <td><span style="color:var(--amber);font-weight:600;">${inc.urgency}</span></td>
                <td><span style="color:var(--blue);font-weight:600;">${assignedUnits}</span></td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-outline" data-action="opschalen" data-id="${inc.id}">Opschalen</button>
                    <button type="button" class="btn btn-outline" data-action="log" data-id="${inc.id}">Log</button>
                    <button type="button" class="btn btn-outline" data-action="samenvoegen" data-id="${inc.id}">Samenvoegen</button>
                    <button type="button" class="btn btn-outline" data-action="afsluiten" data-id="${inc.id}">Statusen</button>
                  </div>
                </td>
              `;
              homeTable.appendChild(trHome);
          });
      }

      // Alle lopende meldingen (beide samen in de Alle Lopende Meldingen tab)
      if (activeIncidents.length === 0) {
          allTable.innerHTML = `<tr><td colspan="7" class="empty-table-msg">Er zijn momenteel geen lopende meldingen.</td></tr>`;
      } else {
          activeIncidents.forEach(inc => {
              const assignedUnits = (inc.units && inc.units.length) ? inc.units.join('<br>') : (inc.unit ? inc.unit : '-');

              const isAssigned = assignedUnits !== '-';
              const opschaalBtn = isAssigned 
                  ? `<button type="button" class="btn btn-outline" data-action="opschalen" data-id="${inc.id}">Opschalen</button>`
                  : `<button type="button" class="btn btn-outline" data-action="opschalen" data-id="${inc.id}" disabled style="opacity: 0.5; cursor: not-allowed;" title="Wijs eerst een eenheid toe">Opschalen</button>`;

              const toewijzenBtn = !isAssigned 
                  ? `<button type="button" class="btn btn-outline" data-action="toewijzen" data-id="${inc.id}">Toewijzen</button>`
                  : ``;

              const trAll = document.createElement('tr');
          makeRowDropTarget(trAll, inc.id);
              trAll.innerHTML = `
                <td><span class="pill pill-on">${inc.status}</span></td>
                <td class="col-time">${inc.time}</td>
                <td><span class="editable-incident-field" data-id="${inc.id}" data-field="location" title="Klik om te bewerken">${inc.location || '<i>Onbekend</i>'}</span></td>
                <td><span class="editable-incident-field" data-id="${inc.id}" data-field="event" title="Klik om te bewerken">${inc.event || '<i>Onbekend</i>'}</span></td>
                <td>${inc.reporter}</td>
                <td><span style="color:var(--blue);font-weight:600;">${assignedUnits}</span></td>
                <td>
                  <div class="row-actions">
                    ${toewijzenBtn}
                    ${opschaalBtn}
                    <button type="button" class="btn btn-outline" data-action="log" data-id="${inc.id}">Log</button>
                    <button type="button" class="btn btn-outline" data-action="samenvoegen" data-id="${inc.id}">Samenvoegen</button>
                    <button type="button" class="btn btn-outline" data-action="afsluiten" data-id="${inc.id}">Statusen</button>
                  </div>
                </td>
              `;
              allTable.appendChild(trAll);
          });
      }

      // Logistieke meldingen tabel
      const logTable = document.getElementById('logistiekIncidentsTable');
      if (logTable) {
          logTable.innerHTML = '';
          if (logistiekActief.length === 0) {
              logTable.innerHTML = `<tr><td colspan="8" class="empty-table-msg">Geen logistieke meldingen...</td></tr>`;
          } else {
              logistiekActief.forEach(inc => {
                  const tr = document.createElement('tr');
                  tr.innerHTML = `
                    <td><span class="pill pill-on">${inc.status}</span></td>
                    <td class="col-time" style="color:var(--text3);font-size:11px">${inc.time}</td>
                    <td><span class="editable-incident-field" data-id="${inc.id}" data-field="location" title="Klik om te bewerken">${inc.location || '<i>Onbekend</i>'}</span></td>
                    <td><span class="editable-incident-field" data-id="${inc.id}" data-field="event" title="Klik om te bewerken">${inc.event || '<i>Onbekend</i>'}</span></td>
                    <td><span class="editable-incident-field" data-id="${inc.id}" data-field="reporter" title="Klik om te bewerken">${inc.reporter || '<i>Onbekend</i>'}</span></td>
                    <td><span class="urgency-badge" data-action="urgentie" data-id="${inc.id}" title="Klik om urgentie te wijzigen" style="color:var(--amber);font-weight:600;cursor:pointer;text-decoration:underline dotted;">${inc.urgency}</span></td>
                    <td>
                      <div class="row-actions">
                        <button type="button" class="btn btn-outline" data-action="log" data-id="${inc.id}">Log</button>
                        <button type="button" class="btn btn-outline" data-action="afsluiten" data-id="${inc.id}">Statusen</button>
                      </div>
                    </td>`;
                  logTable.appendChild(tr);
              });
          }
      }

      // Update the counters
      const countNewEl = document.getElementById('countNew');
      if(countNewEl) countNewEl.innerText = newIncidents.length;

      const countActiveEl = document.getElementById('countActive');
      if(countActiveEl) countActiveEl.innerText = assignedIncidents.length;

      const countLogistiekEl = document.getElementById('countLogistiek');
      if(countLogistiekEl) countLogistiekEl.innerText = logistiekActief.length;

      // Toon of verberg header buttons op basis van of er meldingen zijn
      updateHeaderButtonsVisibility();
      
      // Update rapportage statistieken
      renderRapportage();
      renderIncidentChart();

      attachRowActionHandlers();
  }


  // Helperfunctie om het verschil in minuten te berekenen tussen twee 'HH:MM' tijden (zelfs over middernacht)
  function getDiffInMinutes(startStr, endStr) {
      if (!startStr || !endStr) return null;
      const [h1, m1] = startStr.split(':').map(Number);
      const [h2, m2] = endStr.split(':').map(Number);
      if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return null;
      let startMins = h1 * 60 + m1;
      let endMins = h2 * 60 + m2;
      if (endMins < startMins) endMins += 24 * 60; // Voor meldingen die over middernacht heengaan
      return endMins - startMins;
  }

  function renderRapportage() {
      const closedIncidents = incidents.filter(inc => inc.status.startsWith('Afgesloten'));
      
      const rapTotalClosed = document.getElementById('rapTotalClosed');
      if (rapTotalClosed) rapTotalClosed.innerText = closedIncidents.length;

      let totalMins = 0;
      let validCount = 0;
      const unitCounts = {};

      closedIncidents.forEach(inc => {
          const diff = getDiffInMinutes(inc.time, inc.closedAtTime);
          if (diff !== null) {
              totalMins += diff;
              validCount++;
          }
          if (inc.units) {
              inc.units.forEach(u => {
                  const uName = u.includes(':') ? u.split(':')[1].trim() : u;
                  unitCounts[uName] = (unitCounts[uName] || 0) + 1;
              });
          }
      });

      const rapAvgTime = document.getElementById('rapAvgTime');
      if (rapAvgTime) rapAvgTime.innerText = validCount > 0 ? Math.round(totalMins / validCount) + ' min' : '-';

      let topUnit = '-', maxCount = 0;
      for (const [unit, count] of Object.entries(unitCounts)) {
          if (count > maxCount) { maxCount = count; topUnit = unit; }
      }
      const rapTopUnit = document.getElementById('rapTopUnit');
      if (rapTopUnit) rapTopUnit.innerText = maxCount > 0 ? topUnit + ` (${maxCount}x)` : '-';

      let rapRetourBLS = 0;
      let rapRetourALS = 0;
      let rapLoze = 0;
      let rapZorg = 0;
      let rapDubbel = 0;
      let rapOpen = 0;
      let rapTotalUitruk = 0;
      let rapTotalZelfzorg = 0;

      closedIncidents.forEach(inc => {
          const s = (inc.status || '').toLowerCase();
          if (s.includes('retour bls')) rapRetourBLS++;
          if (s.includes('retour als')) rapRetourALS++;
          if (s.includes('loze melding')) rapLoze++;
          if (s.includes('zorg ter plaatse')) rapZorg++;
          if (s.includes('dubbele melding')) rapDubbel++;

          if (inc.units && inc.units.length > 0) {
              rapTotalUitruk++;
          } else {
              rapTotalZelfzorg++;
          }
      });
      rapOpen = incidents.filter(inc => !inc.status.startsWith('Afgesloten')).length;

      if (document.getElementById('rapRetourBLS')) document.getElementById('rapRetourBLS').innerText = rapRetourBLS;
      if (document.getElementById('rapRetourALS')) document.getElementById('rapRetourALS').innerText = rapRetourALS;
      if (document.getElementById('rapLoze')) document.getElementById('rapLoze').innerText = rapLoze;
      if (document.getElementById('rapZorg')) document.getElementById('rapZorg').innerText = rapZorg;
      if (document.getElementById('rapDubbel')) document.getElementById('rapDubbel').innerText = rapDubbel;
      if (document.getElementById('rapOpen')) document.getElementById('rapOpen').innerText = rapOpen;
      if (document.getElementById('rapTotalUitruk')) document.getElementById('rapTotalUitruk').innerText = rapTotalUitruk;
      if (document.getElementById('rapTotalZelfzorg')) document.getElementById('rapTotalZelfzorg').innerText = rapTotalZelfzorg;
  }

  function renderIncidentChart() {
      const chartContainer = document.getElementById('incidentChartContainer');
      const labelsContainer = document.getElementById('incidentChartLabels');
      if (!chartContainer || !labelsContainer) return;
  
      if (incidents.length === 0) {
          chartContainer.innerHTML = '<div style="color:var(--text3);font-size:13px;">Nog geen meldingen om te tonen.</div>';
          labelsContainer.innerHTML = '';
          return;
      }
  
      // Bepaal het tijdbereik van alle meldingen
      const allTimes = incidents
          .map(inc => {
              if (!inc.time) return null;
              const [h, m] = inc.time.split(':').map(Number);
              return isNaN(h) ? null : h;
          })
          .filter(h => h !== null);
  
      if (allTimes.length === 0) return;
  
      const minHour = Math.min(...allTimes);
      const maxHour = Math.max(...allTimes);
  
      // Maak buckets per uur
      const hours = [];
      for (let h = minHour; h <= maxHour; h++) hours.push(h);
  
      const activeCounts = hours.map(h =>
          incidents.filter(inc => {
              if (!inc.time) return false;
              const [ih] = inc.time.split(':').map(Number);
              return ih === h && !inc.status.startsWith('Afgesloten');
          }).length
      );
  
      const closedCounts = hours.map(h =>
          incidents.filter(inc => {
              if (!inc.time) return false;
              const [ih] = inc.time.split(':').map(Number);
              return ih === h && inc.status.startsWith('Afgesloten');
          }).length
      );
  
      const maxCount = Math.max(...activeCounts.map((a, i) => a + closedCounts[i]), 1);
  
      // Teken de gestapelde balken
      chartContainer.innerHTML = hours.map((h, i) => {
          const total = activeCounts[i] + closedCounts[i];
          const activeH = (activeCounts[i] / maxCount) * 100;
          const closedH = (closedCounts[i] / maxCount) * 100;
  
          return `
              <div style="flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;position:relative;"
                   title="${h}:00 — ${total} melding(en) (${activeCounts[i]} actief, ${closedCounts[i]} afgesloten)">
                  ${total > 0 ? `<span style="font-size:9px;color:var(--text3);margin-bottom:2px;">${total}</span>` : ''}
                  <div style="width:80%;height:${activeH + closedH}px;display:flex;flex-direction:column;border-radius:2px 2px 0 0;overflow:hidden;">
                      <div style="width:100%;height:${activeH}px;background:var(--blue);opacity:0.85;"></div>
                      <div style="width:100%;height:${closedH}px;background:var(--green);opacity:0.7;"></div>
                  </div>
              </div>
          `;
      }).join('');
  
      // Labels
      labelsContainer.style.display = 'flex';
      labelsContainer.innerHTML = hours.map((h, i) => `
          <span style="flex:1;text-align:center;">${String(h).padStart(2,'0')}:00</span>
      `).join('');
  }

   let currentEscalationIncidentId = null;
   let currentAssignIncidentId = null;
   let currentEscalationType = null;
  let currentAfloopIncidentId = null;
  let currentMergeIncidentId = null;
  let currentLogIncidentId = null;

   function handleIncidentAction(action, incidentId) {
       const incident = incidents.find(i => i.id === incidentId);
       if (!incident) return;
       if (action === 'urgentie') {
           // wordt direct afgehandeld via urgency-badge click — hier als fallback
           const badge = document.querySelector(`.urgency-badge[data-id="${incidentId}"]`);
           if (badge) openUrgencyDropdown(incidentId, badge);
       } else if (action === 'opschalen') {
           currentEscalationIncidentId = incidentId;
           document.getElementById('escalationModal').classList.add('show');
       } else if (action === 'toewijzen') {
           openAssignModal(incidentId);
       } else if (action === 'log') {
           currentLogIncidentId = incidentId;
           window.closeOtherInlinePanels('freeLogModal');
           document.getElementById('freeLogModal').classList.add('show');
       } else if (action === 'samenvoegen') {
           openMergeModal(incidentId);
      } else if (action === 'afsluiten') {
        openAfloopModal(incidentId);
      } else if (action === 'tijdlijn') {
        openTimelineModal(incidentId);
       }
   }

   // Types waarbij geen eenheid gekozen hoeft te worden
   const NO_UNIT_ESCALATIONS = new Set(['Assistentie beveiliging', 'Assistentie reddingsbrigade']);

   const assignDropdown = document.getElementById('assignDropdown');
   let assignAnchorEl = null;

   function openAssignModal(incidentId, escalationType = null, ev = null) {
       currentAssignIncidentId = incidentId;
       currentEscalationType = escalationType;

       // Beveiliging/reddingsbrigade: direct registreren zonder eenheidkeuze
       if (escalationType && NO_UNIT_ESCALATIONS.has(escalationType)) {
           const incidentToAssign = incidents.find(i => i.id === incidentId);
           if (incidentToAssign) {
               incidentToAssign.units = incidentToAssign.units || [];
               const label = escalationType;
               if (!incidentToAssign.units.includes(label)) incidentToAssign.units.push(label);
               incidentToAssign.status = escalationType;
               addIncidentAudit(incidentToAssign, `Opschaling geregistreerd: ${label}`);
               setDoc(doc(db, "incidents", incidentToAssign.id), incidentToAssign);
               renderTables(); renderUnits();
               showToast(`${escalationType} geregistreerd.`);
           }
           currentAssignIncidentId = null;
           currentEscalationType = null;
           return;
       }

       document.getElementById('assignDropdownTitle').textContent = escalationType ? escalationType : 'Eenheid toewijzen';
       renderAssignUnitOptions();
       positionDropdown(assignDropdown, ev);
       assignDropdown.classList.add('open');
   }

   function renderAssignUnitOptions() {
       const assignList = document.getElementById('assignUnitList');
       const incident = incidents.find(i => i.id === currentAssignIncidentId);
       if (!incident) { assignList.innerHTML = '<div class="dd-empty">Geen melding geselecteerd.</div>'; return; }

       const typeFilters = {
           'Assistentie ALS': u => u.type === 'ALS',
           'Assistentie 2e BLS team': u => u.type === 'BLS',
           'Assistentie BLS vervoer': u => u.type === 'BLS vervoer',
           'Assistentie ALS vervoer': u => u.type === 'ALS vervoer',
       };

       const baseUnits = units.filter(u => u.status !== 'uitgemeld' && u.status !== 'uitgerukt');
       const typeFn = currentEscalationType && typeFilters[currentEscalationType] ? typeFilters[currentEscalationType] : () => true;
       const availableUnits = baseUnits.filter(typeFn);

       assignList.innerHTML = '';
       if (availableUnits.length === 0) {
           assignList.innerHTML = '<div class="dd-empty">Geen beschikbare eenheden.</div>';
           return;
       }

       availableUnits.forEach(u => {
           const btn = document.createElement('button');
           btn.innerHTML = `<span class="dd-unit-id">${u.id}</span><span class="dd-unit-sub">${u.type} • ${u.status} • ${u.location}</span>`;
           btn.addEventListener('click', (e) => {
               e.stopPropagation();
               const incidentToAssign = incidents.find(i => i.id === currentAssignIncidentId);
               if (!incidentToAssign) return;
               incidentToAssign.units = incidentToAssign.units || [];
               const label = currentEscalationType ? `${currentEscalationType}: ${u.id}` : u.id;
               if (!incidentToAssign.units.includes(label)) incidentToAssign.units.push(label);
               incidentToAssign.status = currentEscalationType ? currentEscalationType : 'Toegewezen';
               u.status = 'uitgerukt';
               u.statusTimestamp = new Date().toISOString();
               u.location = incidentToAssign.location;
               addIncidentAudit(incidentToAssign, `Eenheid toegewezen: ${label}`, u.id);
               setDoc(doc(db, "units", u.id), u);
               setDoc(doc(db, "incidents", incidentToAssign.id), incidentToAssign);
               renderTables(); renderUnits();
               if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
               closeAssignDropdown();
           });
           assignList.appendChild(btn);
       });
   }

   function closeAssignDropdown() {
       assignDropdown.classList.remove('open');
       currentAssignIncidentId = null;
       currentEscalationType = null;
   }

   function closeAssignPanel() { closeAssignDropdown(); }

   // ── Opschalen dropdown ──
   const escalationDropdown = document.getElementById('escalationDropdown');
   let escalationTargetId = null;
   let escalationAnchorEl = null;

   function openEscalationDropdown(incidentId, anchorEl) {
       escalationTargetId = incidentId;
       escalationAnchorEl = anchorEl;
       positionDropdown(escalationDropdown, anchorEl);
       escalationDropdown.classList.add('open');
   }

   escalationDropdown.querySelectorAll('button[data-escalation]').forEach(btn => {
       btn.addEventListener('click', (e) => {
           e.stopPropagation();
           const escalationType = btn.getAttribute('data-escalation');
           const NO_UNIT = new Set(['Assistentie beveiliging', 'Assistentie reddingsbrigade']);
           const targetId = escalationTargetId;
           const mouseX = e.clientX;
           const mouseY = e.clientY;
           escalationDropdown.classList.remove('open');
           escalationTargetId = null;
           if (NO_UNIT.has(escalationType)) {
               const inc = incidents.find(i => i.id === targetId);
               if (inc) {
                   inc.status = escalationType;
                   addIncidentAudit(inc, `${escalationType} geregistreerd`);
                   setDoc(doc(db, "incidents", inc.id), inc);
                   renderTables();
                   showToast(`${escalationType} geregistreerd.`);
               }
           } else {
               openAssignModal(targetId, escalationType, e);
           }
       });
   });

   // ── Afloop / Statusen dropdown ──
   const afloopDropdown = document.getElementById('afloopDropdown');
   let afloopTargetId = null;

   function openAfloopDropdown(incidentId, anchorEl) {
       afloopTargetId = incidentId;
       positionDropdown(afloopDropdown, anchorEl);
       afloopDropdown.classList.add('open');
   }

   afloopDropdown.querySelectorAll('button[data-afloop]').forEach(btn => {
       btn.addEventListener('click', () => {
           const reason = btn.getAttribute('data-afloop');
           handleAfloopChoice(afloopTargetId, reason);
           afloopDropdown.classList.remove('open');
           afloopTargetId = null;
       });
   });

   // ── Samenvoegen dropdown ──
   const mergeDropdown = document.getElementById('mergeDropdown');
   let mergeSourceId = null;

   function openMergeDropdown(incidentId, anchorEl) {
       mergeSourceId = incidentId;
       const list = document.getElementById('mergeDropdownList');
       const targets = incidents.filter(i => i.id !== incidentId && !i.status.startsWith('Afgesloten'));
       list.innerHTML = '';
       if (targets.length === 0) {
           list.innerHTML = '<div class="dd-empty">Geen andere actieve meldingen.</div>';
       } else {
           targets.forEach(inc => {
               const btn = document.createElement('button');
               btn.innerHTML = `<span class="dd-main">${inc.id} — ${inc.location}</span><span class="dd-sub">${inc.event}</span>`;
               btn.addEventListener('click', () => {
                   performMerge(mergeSourceId, inc.id);
                   mergeDropdown.classList.remove('open');
                   mergeSourceId = null;
               });
               list.appendChild(btn);
           });
       }
       positionDropdown(mergeDropdown, anchorEl);
       mergeDropdown.classList.add('open');
   }

   // ── Logistiek statusdropdown (alleen Aangevraagd / Opgelost) ──
   const logistiekStatusDropdown = document.getElementById('logistiekStatusDropdown');
   let logistiekStatusTargetId = null;

   function openLogistiekStatusDropdown(incidentId, anchorEl) {
       logistiekStatusTargetId = incidentId;
       positionDropdown(logistiekStatusDropdown, anchorEl);
       logistiekStatusDropdown.classList.add('open');
   }

   logistiekStatusDropdown.querySelectorAll('button[data-logstatus]').forEach(btn => {
       btn.addEventListener('click', () => {
           const choice = btn.getAttribute('data-logstatus');
           const inc = incidents.find(i => i.id === logistiekStatusTargetId);
           if (inc) {
               if (choice === 'Opgelost') {
                   const nu = new Date();
                   inc.closedAtTime = nu.getHours().toString().padStart(2,'0')+':'+nu.getMinutes().toString().padStart(2,'0');
                   inc.closedAtTimestamp = nu.toISOString();
                   inc.status = 'Afgesloten: Opgelost';
                   addIncidentAudit(inc, 'Logistieke melding opgelost');
               } else {
                   inc.status = 'Aangevraagd';
                   addIncidentAudit(inc, 'Logistieke melding aangevraagd');
               }
               setDoc(doc(db, "incidents", inc.id), inc);
               renderTables(); renderUnits();
               if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
               showToast(`Status gewijzigd naar ${choice}.`);
           }
           logistiekStatusDropdown.classList.remove('open');
           logistiekStatusTargetId = null;
       });
   });

   // ── Log dropdown ──
   const logDropdown = document.getElementById('logDropdown');
   let logDropdownTargetId = null;

   function openLogDropdown(incidentId, anchorEl) {
       logDropdownTargetId = incidentId;
       document.getElementById('logDropdownText').value = '';
       positionDropdown(logDropdown, anchorEl);
       logDropdown.classList.add('open');
       setTimeout(() => document.getElementById('logDropdownText').focus(), 50);
   }

   document.getElementById('logDropdownSave').addEventListener('click', () => {
       const rawText = document.getElementById('logDropdownText').value.trim();
       const inc = incidents.find(i => i.id === logDropdownTargetId);
       if (inc && rawText) {
           applyLogParser(inc, rawText);
           renderTables(); renderUnits();
           if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
           showToast('Log opgeslagen.');
       }
       logDropdown.classList.remove('open');
       logDropdownTargetId = null;
   });

   document.getElementById('logDropdownText').addEventListener('keydown', e => {
       if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('logDropdownSave').click(); }
       if (e.key === 'Escape') { logDropdown.classList.remove('open'); }
   });

   // ── Hulpfunctie: positioneer een dropdown naast een element ──
   function positionDropdown(dropdown, ev) {
       let zoom = parseFloat(document.body.style.zoom || 1);
       if (isNaN(zoom) || zoom === 0) zoom = 1;

       let x = 100;
       let y = 100;

       if (ev && ev.clientX !== undefined) {
           x = ev.clientX / zoom;
           y = ev.clientY / zoom;
       } else if (ev && ev.getBoundingClientRect) {
           const rect = ev.getBoundingClientRect();
           x = rect.left / zoom;
           y = rect.bottom / zoom;
       }

       const maxRight = (window.innerWidth / zoom) - 340;
       if (x > maxRight) x = maxRight - 10;

       dropdown.style.top = (y + 4) + 'px';
       dropdown.style.left = x + 'px';
   }

   // ── Sluit alle dropdowns bij klik buiten ──
   function closeAllRowDropdowns() {
       closeAssignDropdown();
       escalationDropdown.classList.remove('open'); escalationTargetId = null;
       afloopDropdown.classList.remove('open');
       logistiekStatusDropdown.classList.remove('open'); logistiekStatusTargetId = null;
       mergeDropdown.classList.remove('open');
       logDropdown.classList.remove('open');
   }

   document.addEventListener('click', (e) => {
       if (!assignDropdown.contains(e.target) && !e.target.closest('[data-action="toewijzen"]')) closeAssignDropdown();
       if (!escalationDropdown.contains(e.target) && !e.target.closest('[data-action="opschalen"]')) { escalationDropdown.classList.remove('open'); escalationTargetId = null; }
       if (!afloopDropdown.contains(e.target) && !e.target.closest('[data-action="afsluiten"]')) { afloopDropdown.classList.remove('open'); }
       if (!logistiekStatusDropdown.contains(e.target) && !e.target.closest('[data-action="afsluiten"]')) { logistiekStatusDropdown.classList.remove('open'); logistiekStatusTargetId = null; }
       if (!mergeDropdown.contains(e.target) && !e.target.closest('[data-action="samenvoegen"]')) { mergeDropdown.classList.remove('open'); }
       if (!logDropdown.contains(e.target) && !e.target.closest('[data-action="log"]')) { logDropdown.classList.remove('open'); }
   });

   function closeEscalationModal() {
       document.getElementById('escalationModal').classList.remove('show');
       currentEscalationIncidentId = null;
   }

   // Urgentie dropdown
   let urgencyTargetId = null;
   const urgencyDropdown = document.getElementById('urgencyDropdown');

   function openUrgencyDropdown(incidentId, anchorEl) {
       urgencyTargetId = incidentId;
       const rect = anchorEl.getBoundingClientRect();

       let zoom = parseFloat(document.body.style.zoom || 1);
       if (isNaN(zoom) || zoom === 0) zoom = 1;

       urgencyDropdown.style.top = ((rect.bottom / zoom) + 4) + 'px';
       urgencyDropdown.style.left = Math.min(rect.left / zoom, (window.innerWidth / zoom) - 230) + 'px';
       urgencyDropdown.classList.add('open');
   }

   function closeUrgencyDropdown() {
       urgencyDropdown.classList.remove('open');
       urgencyTargetId = null;
   }

   urgencyDropdown.querySelectorAll('button[data-urgency]').forEach(btn => {
       btn.addEventListener('click', () => {
           const newUrgency = btn.getAttribute('data-urgency');
           const incident = incidents.find(i => i.id === urgencyTargetId);
           if (incident) {
               const old = incident.urgency;
               incident.urgency = newUrgency;
               addIncidentAudit(incident, `Urgentie gewijzigd: ${old} → ${newUrgency}`);
               setDoc(doc(db, "incidents", incident.id), incident);
               renderTables();
           }
           closeUrgencyDropdown();
       });
   });

   document.addEventListener('click', (e) => {
       if (!urgencyDropdown.contains(e.target) && !e.target.classList.contains('urgency-badge')) {
           closeUrgencyDropdown();
       }
   });

   document.querySelectorAll('#escalationModal .option-btn[data-escalation]').forEach(btn => {
       btn.addEventListener('click', () => {
           const escalationType = btn.getAttribute('data-escalation');
           const incidentId = currentEscalationIncidentId;
           closeEscalationModal();
           openAssignModal(incidentId, escalationType);
       });
   });

   document.getElementById('escalationCloseBtn')?.addEventListener('click', closeEscalationModal);

   function closeAssignModal() { closeAssignPanel(); }

   function openTimelineModal(incidentId) {
       const incident = incidents.find(i => i.id === incidentId);
       if (!incident) return;
       
       document.getElementById('timelineIncidentId').innerText = incidentId;
       const content = document.getElementById('timelineContent');
       
       // Visual Timeline Logic
       let hasMelding = true; // Altijd waar als hij in het systeem staat
       let hasToegewezen = (incident.units && incident.units.length > 0);
       let hasTerPlaatse = false;
       let hasRetour = false;
       let hasAfgesloten = incident.status.startsWith('Afgesloten');
       
       if (incident.auditTrail) {
           incident.auditTrail.forEach(entry => {
               const act = entry.action.toLowerCase();
               if (act.includes('toegewezen') || act.includes('opschaling')) hasToegewezen = true;
               if (act.includes('ter plaatse')) hasTerPlaatse = true;
               if (act.includes('retour')) hasRetour = true;
           });
       }

       const getStep = (name, active, stepNum) => `
           <div class="progress-step ${active ? 'active' : ''}">
               <div class="circle">${active ? '&#10004;' : stepNum}</div>
               <span>${name}</span>
           </div>
       `;

       const progressBarHtml = `
           <div class="progress-bar-container">
               ${getStep('Melding', hasMelding, '1')}
               ${getStep('Toegewezen', hasToegewezen, '2')}
               ${getStep('Ter Plaatse', hasTerPlaatse, '3')}
               ${getStep('Retour', hasRetour, '4')}
               ${getStep('Afgesloten', hasAfgesloten, '5')}
           </div>
       `;

       if (!incident.auditTrail || incident.auditTrail.length === 0) {
           content.innerHTML = '<div class="empty-table-msg">Geen tijdlijn gegevens beschikbaar voor deze melding.</div>';
       } else {
           let html = progressBarHtml + '<div class="timeline-container">';
           incident.auditTrail.forEach(entry => {
               const userStr = entry.user ? `<div class="timeline-user"><svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;margin-right:4px;"><circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/></svg>${entry.user}</div>` : '';
               html += `
                   <div class="timeline-item">
                       <div class="timeline-dot"></div>
                       <div class="timeline-content">
                           <div class="timeline-time">${entry.time}</div>
                           <div class="timeline-action">${entry.action}</div>
                           ${userStr}
                       </div>
                   </div>
               `;
           });
           html += '</div>';
           content.innerHTML = html;
       }
       document.getElementById('timelineModal').classList.add('show');
   }

   const timelineCloseBtn = document.getElementById('timelineCloseBtn');
   if (timelineCloseBtn) {
       timelineCloseBtn.addEventListener('click', () => {
           document.getElementById('timelineModal').classList.remove('show');
       });
   }
   
   function openMergeModal(incidentId) {
       currentMergeIncidentId = incidentId;
       const list = document.getElementById('mergeOptionList');
       const activeIncidents = incidents.filter(i => i.id !== incidentId && !i.status.startsWith('Afgesloten'));
       
       if (activeIncidents.length === 0) {
           list.innerHTML = '<div class="empty-assign-msg">Geen andere actieve meldingen om mee samen te voegen.</div>';
       } else {
           list.innerHTML = activeIncidents.map(inc => `
               <button type="button" class="option-btn" data-merge-target="${inc.id}">
                   <strong>${inc.id} - ${inc.location}</strong>
                   <span>${inc.event} (Melder: ${inc.reporter})</span>
               </button>
           `).join('');
           
           list.querySelectorAll('.option-btn').forEach(btn => {
               btn.addEventListener('click', () => {
                   const targetId = btn.getAttribute('data-merge-target');
                   performMerge(currentMergeIncidentId, targetId);
               });
           });
       }
       document.getElementById('mergeModal').classList.add('show');
   }
   
   function performMerge(sourceId, targetId) {
       const source = incidents.find(i => i.id === sourceId);
       const target = incidents.find(i => i.id === targetId);
       if (!source || !target) return;
       
       if (source.units && source.units.length > 0) {
           target.units = target.units || [];
           source.units.forEach(u => {
               if (!target.units.includes(u)) {
                   target.units.push(u);
               }
               const unitName = u.includes(':') ? u.split(':')[1].trim() : u;
               const unitObj = units.find(unit => unit.id === unitName);
               if (unitObj) {
                   unitObj.location = target.location;
                   setDoc(doc(db, "units", unitObj.id), unitObj);
               }
           });
       }
       
       target.event += ` | [Samenvoeging uit ${source.id}]: ${source.event} (Melder: ${source.reporter})`;
       addIncidentAudit(target, `Melding ${source.id} is hierin samengevoegd.`);
       setDoc(doc(db, "incidents", target.id), target);

       const nu = new Date();
       const tijdString = nu.getHours().toString().padStart(2, '0') + ":" + nu.getMinutes().toString().padStart(2, '0');
       source.closedAtTime = tijdString;
       source.closedAtTimestamp = nu.toISOString();
       source.status = 'Afgesloten: Dubbele melding';
       addIncidentAudit(source, `Samengevoegd in melding ${target.id}`);
       setDoc(doc(db, "incidents", source.id), source);
       
       document.getElementById('mergeModal').classList.remove('show');
       currentMergeIncidentId = null;
       renderTables();
       renderUnits();
       renderDetailedUnitsTable();
       showToast(`Melding ${source.id} samengevoegd in ${target.id}`);
   }
   
   document.getElementById('mergeCloseBtn').addEventListener('click', () => {
       document.getElementById('mergeModal').classList.remove('show');
       currentMergeIncidentId = null;
   });
   
   function handleAfloopChoice(incidentId, reason) {
       const incident = incidents.find(i => i.id === incidentId);
       if (!incident) return;

       // Ter plaatse: status updaten, melding blijft staan
       if (reason === 'Ter plaatse') {
           incident.status = 'Ter plaatse';
           addIncidentAudit(incident, 'Ter plaatse geregistreerd');
           setDoc(doc(db, "incidents", incident.id), incident);
           renderTables(); renderUnits();
           if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
           showToast('Ter plaatse geregistreerd.');
           return;
       }

       // Zorg ter plaatse / Retour BLS/ALS: alleen loggen, melding blijft staan
       const logOnly = ['Zorg ter plaatse', 'Retour BLS', 'Retour ALS'];
       if (logOnly.includes(reason)) {
           incident.status = reason;
           addIncidentAudit(incident, `${reason} geregistreerd`);
           setDoc(doc(db, "incidents", incident.id), incident);
           const upUnits = incident.units || [];
           upUnits.forEach(uidStr => {
               const uName = uidStr.includes(':') ? uidStr.split(':')[1].trim() : uidStr;
               const u = units.find(x => uName === x.id);
               if (u) {
                   u.status = 'retour post';
                   if (u.gekoppeldAanPost) u.location = u.gekoppeldAanPost;
                   setDoc(doc(db, "units", u.id), u);
                   addLog('Status', `${reason}`, u.id, incident.id, incident.location);
               }
           });
           renderTables(); renderUnits();
           if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
           showToast(`${reason} geregistreerd in log.`);
           return;
       }

       // Overige opties: melding afsluiten
       const nu = new Date();
       incident.closedAtTime = nu.getHours().toString().padStart(2,'0')+':'+nu.getMinutes().toString().padStart(2,'0');
       incident.closedAtTimestamp = nu.toISOString();
       incident.status = `Afgesloten: ${reason}`;
       addIncidentAudit(incident, `Melding afgesloten (${reason})`);
       setDoc(doc(db, "incidents", incident.id), incident);

       const upUnits = incident.units || [];
       upUnits.forEach(uidStr => {
           const uName = uidStr.includes(':') ? uidStr.split(':')[1].trim() : uidStr;
           const u = units.find(x => uName === x.id);
           if (u) {
               const oldStatus = u.status;
               u.status = 'inzetbaar';
               if (oldStatus !== u.status) { setDoc(doc(db, "units", u.id), u); addLog('Status', `Eenheid inzetbaar na afsluiting`, u.id, incident.id, incident.location); }
           }
       });
       renderTables(); renderUnits();
       if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
   }

   function openAfloopModal(incidentId) {
       currentAfloopIncidentId = incidentId;
       document.getElementById('afloopModal').classList.add('show');
   }

   document.getElementById('afloopCloseBtn')?.addEventListener('click', () => {
       document.getElementById('afloopModal').classList.remove('show');
       currentAfloopIncidentId = null;
   });

   document.querySelectorAll('#afloopModal .option-btn').forEach(btn => {
       btn.addEventListener('click', () => {
           const reason = btn.getAttribute('data-afloop');
           const incident = incidents.find(i => i.id === currentAfloopIncidentId);
           if (!incident) return;
           
           const closingReasons = ['Inzetbaar', 'Loze melding', 'Retour BLS', 'Retour ALS', 'Dubbele melding', 'Brand meester', 'Assistentie Brandweer'];
           const isClosing = closingReasons.includes(reason);

           if (isClosing) {
               const nu = new Date();
               const tijdString = nu.getHours().toString().padStart(2, '0') + ":" + nu.getMinutes().toString().padStart(2, '0');
               incident.closedAtTime = tijdString;
               incident.closedAtTimestamp = nu.toISOString();
               incident.status = `Afgesloten: ${reason}`;
               addIncidentAudit(incident, `Melding afgesloten (${reason})`);
           } else {
               incident.status = reason;
               addIncidentAudit(incident, `Status gewijzigd naar: ${reason}`);
           }
           
           setDoc(doc(db, "incidents", incident.id), incident);

           const upUnits = incident.units || [];
           upUnits.forEach(uidStr => {
               const uName = uidStr.includes(':') ? uidStr.split(':')[1].trim() : uidStr;
               const u = units.find(x => uName === x.id);
               if (u) {
                   let oldStatus = u.status;
                   if (['Inzetbaar', 'Loze melding', 'Dubbele melding', 'Brand meester', 'Assistentie Brandweer'].includes(reason)) {
                       u.status = 'inzetbaar';
                   } else if (reason === 'Retour ALS' || reason === 'Retour BLS') {
                       u.status = 'retour post';
                       if (u.gekoppeldAanPost) {
                           u.location = u.gekoppeldAanPost;
                       }
                   }
                   
                   if (oldStatus !== u.status) {
                       setDoc(doc(db, "units", u.id), u);
                       addLog('Status', `Status gewijzigd naar: ${u.status}`, u.id, incident.id, incident.location);
                   }
               }
           });

           renderTables();
           renderUnits();
           if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
           document.getElementById('afloopModal').classList.remove('show');
           currentAfloopIncidentId = null;
       });
   });

   function attachRowActionHandlers() {
       document.querySelectorAll('.row-actions button').forEach(btn => {
           const clone = btn.cloneNode(true);
           btn.parentNode.replaceChild(clone, btn);
       });
       document.querySelectorAll('.row-actions button').forEach(btn => {
           btn.addEventListener('click', (e) => {
               e.stopPropagation();
               const action = btn.getAttribute('data-action');
               const id = btn.getAttribute('data-id');
               closeAllRowDropdowns();
               if (action === 'toewijzen') {
                   openAssignModal(id, null, e);
               } else if (action === 'opschalen') {
                   openEscalationDropdown(id, e);
               } else if (action === 'afsluiten') {
                   if (id && id.startsWith('L-')) {
                       openLogistiekStatusDropdown(id, e);
                   } else {
                       openAfloopDropdown(id, e);
                   }
               } else if (action === 'samenvoegen') {
                   openMergeDropdown(id, e);
               } else if (action === 'log') {
                   openLogDropdown(id, e);
               } else {
                   handleIncidentAction(action, id);
               }
           });
       });
       // Urgentie-badge opent kleine dropdown
       document.querySelectorAll('.urgency-badge[data-action="urgentie"]').forEach(badge => {
           badge.addEventListener('click', (e) => {
               e.stopPropagation();
               openUrgencyDropdown(badge.getAttribute('data-id'), badge);
           });
       });
   }

   // Wijzigingsgeschiedenis (Inline editing in tabellen)
   $(document).off("click", ".editable-incident-field");
   $(document).on("click", ".editable-incident-field", function(e) {
       e.stopPropagation();
       var $span = $(this);
       if ($span.find("input").length > 0) return;

       var currentText = $span.text().trim();
       if (currentText === 'Onbekend') currentText = '';

       var incId = $span.data("id");
       var field = $span.data("field");

       var $input = $("<input>", {
           type: "text",
           value: currentText,
           class: "edit-field-input",
           style: "width: 100%; min-width: 150px; font-size: 13px; padding: 4px; border: 1px solid var(--green); border-radius: 4px; background: var(--bg0); color: var(--text1); outline: none;"
       });

       $span.empty().append($input);
       $input.focus().select();

       var saved = false;
       var save = function() {
           if (saved) return;
           saved = true;
           var newVal = $input.val().trim();
           if (newVal !== currentText) {
               const incIndex = incidents.findIndex(x => x.id === incId);
               if (incIndex !== -1) {
                   incidents[incIndex][field] = newVal;
                   const fieldNameNL = field === 'location' ? 'Locatie' : 'Gebeurtenis';
                   addIncidentAudit(incidents[incIndex], `${fieldNameNL} gewijzigd naar "${newVal}"`);
                   setDoc(doc(db, "incidents", incidents[incIndex].id), incidents[incIndex]);
               }
           }
           renderTables();
       };

       $input.on("blur", save);
       $input.on("keydown", function(e) {
           if (e.which === 13) { e.preventDefault(); $input.blur(); }
           if (e.which === 27) { saved = true; $span.html(currentText || '<i>Onbekend</i>'); }
       });
       $input.click(function(e) { e.stopPropagation(); });
   });

   // ── Gedeelde log-parser: past shortcodes toe op een incident ──
   function applyLogParser(inc, rawText) {
       inc.details = inc.details || {};
       let text = rawText;
       let parsedNotes = [];

       // -bls en -als
       const isBls = /(^|\s)-bls\b/i.test(text);
       const isAls = /(^|\s)-als\b/i.test(text);
       if (isBls || isAls) {
           const type = isBls ? 'BLS' : 'ALS';
           inc.status = `Retour ${type}`;
           parsedNotes.push(`Status gewijzigd naar Retour ${type}`);
           if (inc.units && inc.units.length > 0) {
               inc.units.forEach(uidStr => {
                   const uName = uidStr.includes(':') ? uidStr.split(':')[1].trim() : uidStr;
                   const unitToUpdate = units.find(u => u.id === uName);
                   if (unitToUpdate) {
                       unitToUpdate.status = 'retour post';
                       if (unitToUpdate.gekoppeldAanPost) unitToUpdate.location = unitToUpdate.gekoppeldAanPost;
                       setDoc(doc(db, "units", unitToUpdate.id), unitToUpdate);
                   }
               });
               parsedNotes.push('Eenheid status naar retour post');
           }
           text = text.replace(/(^|\s)-bls\b/gi, '').replace(/(^|\s)-als\b/gi, '').trim();
       }

       // -a2, -a1, -a0
       const ambMatch = text.match(/(^|\s)-a([012])\b/i);
       if (ambMatch) { parsedNotes.push(`Ambulance urgentie: A${ambMatch[2]}`); text = text.replace(/(^|\s)-a[012]\b/gi, '').trim(); }

       // -ehtp / tp → status "Ter plaatse"
       if (/(^|\s)-ehtp\b|(^|\s)\btp\b/i.test(text)) {
           inc.status = 'Ter plaatse';
           parsedNotes.push('Status → Ter plaatse');
           text = text.replace(/(^|\s)-ehtp\b/gi, '').replace(/(^|\s)\btp\b/gi, '').trim();
       }

       // -nb (Nader Bericht)
       let isNaderBericht = false;
       if (/(^|\s)-nb\b/i.test(text)) { isNaderBericht = true; text = text.replace(/(^|\s)-nb\b/gi, '').trim(); }

       const extractVal = (regex) => {
           const match = text.match(regex);
           if (match) { text = text.replace(match[0], '').trim(); return match[2].trim(); }
           return null;
       };
       const extractTextVal = (prefix) => {
           const regex = new RegExp(`(?:^|\\s)-${prefix}\\s+(.*?)(?=\\s+-[a-z]|$)`, 'i');
           const match = text.match(regex);
           if (match) { text = text.replace(match[0], '').trim(); return match[1].trim(); }
           return null;
       };

       const urgVal = extractVal(/(^|\s)-urg\s+([123])/i);
       if (urgVal) { const urgMap = { '1': 'Spoed', '2': 'Direct Vertrekken', '3': 'Uitstelmogelijkheid' }; inc.urgency = urgMap[urgVal]; parsedNotes.push(`Urgentie gewijzigd naar: ${inc.urgency}`); }

       const gesVal = extractVal(/(^|\s)-ges\s+([mv])/i);
       if (gesVal) { const g = gesVal.toLowerCase() === 'm' ? 'Man' : 'Vrouw'; inc.details.gender = g; parsedNotes.push(`Geslacht: ${g}`); }

       const dVal = extractVal(/(^|\s)-d\s+([avpu])/i);
       if (dVal) { const dMap = { 'a': 'Alert', 'v': 'Verbal', 'p': 'Pain', 'u': 'Unresponsive' }; inc.details.disability = dMap[dVal.toLowerCase()]; parsedNotes.push(`Disability (D): ${inc.details.disability}`); }

       const fields = [ { key: 'dnr', prop: 'dnr', label: 'Deelnemersnummer', inDetails: true }, { key: 'loc', prop: 'location', label: 'Locatie', inDetails: false }, { key: 'geb', prop: 'event', label: 'Gebeurtenis', inDetails: false }, { key: 'melder', prop: 'reporter', label: 'Melder', inDetails: false }, { key: 'xps', prop: 'xps', label: 'XPS', inDetails: true }, { key: 'a', prop: 'airway', label: 'Airway (A)', inDetails: true }, { key: 'b', prop: 'breathing', label: 'Breathing (B)', inDetails: true }, { key: 'c', prop: 'circulation', label: 'Circulation (C)', inDetails: true }, { key: 'e', prop: 'exposure', label: 'Exposure (E)', inDetails: true } ];
       fields.forEach(f => {
           const val = extractTextVal(f.key);
           if (val) { if (f.inDetails) { inc.details[f.prop] = val; } else { inc[f.prop] = val; } parsedNotes.push(`${f.label}: ${val}`); }
       });

       if (text.length > 0) {
           if (isNaderBericht) {
               addLog('Nader bericht', text, '', inc.id, inc.location);
               const timeStr = new Date().getHours().toString().padStart(2,'0')+':'+new Date().getMinutes().toString().padStart(2,'0');
               const user = auth.currentUser ? auth.currentUser.email.split('@')[0] : 'Systeem';
               inc.auditTrail = inc.auditTrail || [];
               inc.auditTrail.push({ time: timeStr, action: `Nader bericht: ${text}`, user: user });
           } else {
               addIncidentAudit(inc, `Lognotitie: ${text}`);
           }
       }
       if (parsedNotes.length > 0) addIncidentAudit(inc, `Parser updates: ${parsedNotes.join(' | ')}`);
       setDoc(doc(db, "incidents", inc.id), inc);
   }

   // Free Text Log Modal Logic
   const freeLogModal = document.getElementById('freeLogModal');
   const freeLogForm = document.getElementById('freeLogForm');

   if (freeLogForm) {
       freeLogForm.addEventListener('submit', async (e) => {
           e.preventDefault();
           let text = new FormData(freeLogForm).get('logText').trim();
           const inc = incidents.find(i => i.id === currentLogIncidentId);
           if (inc && text) {
               applyLogParser(inc, text);
               renderTables(); renderUnits(); if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
               showToast('Log & parser updates succesvol doorgevoerd.');
               freeLogModal.classList.remove('show');
               freeLogForm.reset();
           } else if (text) {
               addLog('Notitie', text, '', null, '');
               showToast('Globale lognotitie toegevoegd.');
               freeLogModal.classList.remove('show'); freeLogForm.reset();
           }
       });
   }
   
   document.getElementById('freeLogCloseBtn')?.addEventListener('click', () => { freeLogModal.classList.remove('show'); });
   document.getElementById('freeLogCancelBtn')?.addEventListener('click', () => { freeLogModal.classList.remove('show'); freeLogForm.reset(); });

  const navButtons = document.querySelectorAll('.nav-btn');
  const views = document.querySelectorAll('.view');
  navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-target');
          const action = btn.getAttribute('data-action');

          // Logic for action buttons (like 'uitloggen') that don't switch views
          if (action) {
              if (action === 'uitloggen') {
                signOut(auth).then(() => {
                    showToast('Succesvol uitgelogd');
                }).catch((error) => {
                    showToast('Uitloggen mislukt', true);
                });
              } else {
                showToast(`Actie: ${action}`);
              }
              return; // Stop processing, don't change active view
          }

          // Logic for view-switching buttons
          if (target) {
              navButtons.forEach(b => b.classList.remove('active'));
              views.forEach(v => v.classList.remove('active'));
              btn.classList.add('active');
              document.getElementById(target).classList.add('active');

              // Show/hide right panel based on view
              const rightPanel = document.querySelector('.right');
              const bodyLayout = document.querySelector('.body');
              const isMobile = window.innerWidth <= 1100;
              const isPopout = new URLSearchParams(window.location.search).get('popout') === 'true';

              if (target === 'view-home' && !isPopout) {
                  rightPanel.style.display = 'flex';
                  if (!isMobile) bodyLayout.style.gridTemplateColumns = '1fr 340px';
              } else if (!isPopout) {
                  rightPanel.style.display = 'none';
                  if (!isMobile) bodyLayout.style.gridTemplateColumns = '1fr';
              }

              // Specific logic for 'view-eenheden'
              if (target === 'view-eenheden') {
                  if (unitFormSection) unitFormSection.style.display = 'none';
                  if (importCsvFormSection) importCsvFormSection.style.display = 'none';
                  if (bulkUnitFormSection) bulkUnitFormSection.style.display = 'none';
                  resetUnitFormButtons();
                  renderDetailedUnitsTable();
              } else {
                  if (unitFormSection) unitFormSection.style.display = 'none';
                  if (bulkUnitFormSection) bulkUnitFormSection.style.display = 'none';
              }
              if (importCsvFormSection) importCsvFormSection.style.display = 'none';

              // Specific logic for 'view-posten'
              if (target === 'view-posten') {
                  if (typeof renderDetailedPostsTable === 'function') renderDetailedPostsTable();
              }
          }
      });
  });

  // --- Generieke Modal Setup ---
  function setupModal(modalId, openBtnId, formId) {
      const modal = document.getElementById(modalId);
      const openBtn = document.getElementById(openBtnId);
      const form = formId ? document.getElementById(formId) : null;
      if (!modal || !openBtn) return;

      openBtn.addEventListener('click', () => {
          if (!modal.classList.contains('show')) window.closeOtherInlinePanels(modalId);
          const isOpen = modal.classList.toggle('show');
          if (isOpen) modal.querySelector('input, textarea, select')?.focus();
      });

      modal.querySelectorAll('.modal-close, .btn-cancel').forEach(btn => {
          btn.addEventListener('click', () => {
              modal.classList.remove('show');
              if (form) form.reset();
          });
      });
  }

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
          if (e.target === overlay) overlay.classList.remove('show');
          if (e.target.classList.contains('modal-close')) overlay.classList.remove('show');
      });
  });

          // Sluit alle andere inline uitklap-panelen wanneer er één geopend wordt
          window.closeOtherInlinePanels = function(exceptId) {
              [
                  ['quickMedicalInlineContainer', 'display'],
                  ['detailedMedicalInlineContainer', 'display'],
                  ['brandwachtModal', 'class'],
                  ['logistiekModal', 'class'],
                  ['freeLogModal', 'class']
              ].forEach(([id, mode]) => {
                  if (id === exceptId) return;
                  const el = document.getElementById(id);
                  if (!el) return;
                  if (mode === 'display') el.style.display = 'none';
                  else el.classList.remove('show');
                  el.querySelector('form')?.reset();
              });
          };

          // Detailed SBAR inline dropdown handlers (zelfde gedrag als snelle medische melding)
          const detailedContainer = document.getElementById('detailedMedicalInlineContainer');
          const detailedForm = document.getElementById('detailedMedicalForm');
          document.getElementById('btnDetailedMedical').addEventListener('click', () => {
              const isOpen = detailedContainer.style.display !== 'none';
              if (!isOpen) window.closeOtherInlinePanels('detailedMedicalInlineContainer');
              detailedContainer.style.display = isOpen ? 'none' : 'block';
              if (!isOpen) detailedContainer.querySelector('input[name="reporter"]')?.focus();
          });
          document.getElementById('detailedCloseBtn').addEventListener('click', () => { detailedContainer.style.display = 'none'; detailedForm.reset(); });
          document.getElementById('detailedCancel').addEventListener('click', () => { detailedContainer.style.display = 'none'; detailedForm.reset(); });

          detailedForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(detailedForm);
            const reporter = (fd.get('reporter') || '').toLowerCase().trim();
            let assignedUnit = "-";
            if (reporter.startsWith('u') && reporter.length > 1 && !isNaN(reporter.substring(1))) {
              const uNum = reporter.substring(1).padStart(2, '0');
              const unitToUpdate = units.find(u => u.id === `BLS-${uNum}` || u.id === `ALS-${uNum}`);
              if (unitToUpdate) {
                assignedUnit = unitToUpdate.id;
                unitToUpdate.status = 'uitgerukt';
                unitToUpdate.location = fd.get('location');
                setDoc(doc(db, "units", unitToUpdate.id), unitToUpdate);
              }
            }

            const now = new Date();
            const timeStr = now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');

            const recommendations = [];
            detailedForm.querySelectorAll('input[name="rec"]:checked').forEach(cb => recommendations.push(cb.value));

            incidents.push({
              id: 'M-' + Date.now() + '-' + Math.floor(Math.random() * 999),
              status: assignedUnit && assignedUnit !== '-' ? 'Toegewezen' : 'Nieuw',
              time: timeStr,
              location: fd.get('location'),
              event: fd.get('description') || 'SBAR melding',
              reporter: fd.get('reporter'),
              urgency: fd.get('urgency'),
              units: assignedUnit && assignedUnit !== '-' ? [assignedUnit] : [],
              details: {
                phone: fd.get('phone'),
                age: fd.get('age'),
                gender: fd.get('gender'),
                participantNumber: fd.get('participantNumber'),
                careContactNumber: fd.get('careContactNumber'),
                airway: fd.get('airway'),
                breathing: fd.get('breathing'),
                circulation: fd.get('circulation'),
                disability: fd.get('disability'),
                exposure: fd.get('exposure'),
                background: fd.get('background'),
                assessment: fd.get('assessment'),
                recommendations
              }
            });
            addIncidentAudit(incidents[incidents.length - 1], `Aangemaakt (SBAR) - ${fd.get('urgency')}`);

            setDoc(doc(db, "incidents", incidents[incidents.length - 1].id), incidents[incidents.length - 1]);
            renderTables();
            renderUnits();
            renderDetailedUnitsTable();
            detailedContainer.style.display = 'none';
            detailedForm.reset();
          });

  // ==========================================
  // ACCOUNTINSTELLINGEN (Wachtwoord)
  // ==========================================
  if (changePasswordForm) {
      changePasswordForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const newPass = document.getElementById('newPassword').value;
          const confirmPass = document.getElementById('newPasswordConfirm').value;
          if (newPass !== confirmPass) {
              showToast('Wachtwoorden komen niet overeen.', true);
              return;
          }
          
          if (newPass.length < 6) {
              showToast('Wachtwoord moet minimaal 6 tekens bevatten.', true);
              return;
          }

          try {
              if (auth.currentUser) {
                  await updatePassword(auth.currentUser, newPass);
                  showToast('Wachtwoord succesvol gewijzigd!');
                  changePasswordForm.reset();
              }
          } catch (error) {
              console.error("Fout bij wachtwoord wijzigen:", error);
              if (error.code === 'auth/requires-recent-login') {
                  showToast('Log opnieuw in om je wachtwoord te kunnen wijzigen.', true);
                  signOut(auth);
              } else {
                  showToast('Fout bij wijzigen wachtwoord.', true);
              }
          }
      });
  }

  // ==========================================
  // BRANDWACHT MELDING FORMULIER
  // ==========================================
  const bwForm = document.getElementById('brandwachtForm');
  const bwModal = document.getElementById('brandwachtModal');

  if (bwForm) {
      bwForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const formData = new FormData(bwForm);
          const melder = formData.get('reporter').toLowerCase().trim();
          
          let assignedUnit = "-";
          
          // Systeem intelligentie: herken bw1, bw2 -> BW-01, BW-02
          if (melder.startsWith('bw') && melder.length > 2 && !isNaN(melder.substring(2))) {
              const bwNum = melder.substring(2).padStart(2, '0');
              assignedUnit = `BW-${bwNum}`;
              const unitToUpdate = units.find(u => u.id === assignedUnit);
              if(unitToUpdate) {
                  unitToUpdate.status = "uitgerukt";
                  unitToUpdate.location = formData.get('location'); 
                  setDoc(doc(db, "units", unitToUpdate.id), unitToUpdate);
              }
          }

          const nu = new Date();
          const tijdString = nu.getHours().toString().padStart(2, '0') + ":" + nu.getMinutes().toString().padStart(2, '0');

          incidents.push({
              id: "BW-" + Date.now() + "-" + Math.floor(Math.random() * 999), 
              status: assignedUnit && assignedUnit !== '-' ? 'Toegewezen' : 'Nieuw',
              time: tijdString,
              location: formData.get('location'),
              event: formData.get('description'),
              reporter: formData.get('reporter'),
              urgency: formData.get('urgency'),
              units: assignedUnit && assignedUnit !== '-' ? [assignedUnit] : []
          });
          addIncidentAudit(incidents[incidents.length - 1], `Brandwacht melding aangemaakt - ${formData.get('urgency')}`);

          setDoc(doc(db, "incidents", incidents[incidents.length - 1].id), incidents[incidents.length - 1]);
          renderTables();
          renderUnits();
          if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
          
          bwModal.classList.remove('show');
          bwForm.reset();
          showToast('Brandwacht melding succesvol aangemaakt.');
      });
  }

  // ==========================================
  // LOGISTIEKE MELDING FORMULIER
  // ==========================================
  const logForm = document.getElementById('logistiekForm');
  const logModal = document.getElementById('logistiekModal');

  if (logForm) {
      logForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const formData = new FormData(logForm);

          const nu = new Date();
          const tijdString = nu.getHours().toString().padStart(2, '0') + ":" + nu.getMinutes().toString().padStart(2, '0');

          incidents.push({
              id: "L-" + Date.now() + "-" + Math.floor(Math.random() * 999),
              status: 'Aangevraagd',
              time: tijdString,
              location: formData.get('location'),
              event: formData.get('description'),
              reporter: formData.get('reporter'),
              urgency: formData.get('urgency'),
              units: []
          });
          addIncidentAudit(incidents[incidents.length - 1], `Logistieke melding aangemaakt - ${formData.get('urgency')}`);

          setDoc(doc(db, "incidents", incidents[incidents.length - 1].id), incidents[incidents.length - 1]);
          renderTables();
          renderUnits();
          if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
          
          logModal.classList.remove('show');
          logForm.reset();
          showToast('Logistieke melding succesvol aangemaakt.');
      });
  }

  // Re-attach row buttons after each re-render
  function refreshRowActions() {
      attachRowActionHandlers();
  }

  // ==========================================
  // EENHEDEN INVOER FORMULIER
  // ==========================================
  const importCsvForm = document.getElementById('importCsvForm');
  const cancelImportCsvFormBtn = document.getElementById('cancelImportCsvFormBtn');

  // Function to reset button styles for the form toggles
  function resetUnitFormButtons() {
      if (showAddUnitFormBtn) {
          showAddUnitFormBtn.classList.remove('btn-submit');
          showAddUnitFormBtn.classList.add('btn-outline');
      }
      if (showBulkAddUnitFormBtn) {
          showBulkAddUnitFormBtn.classList.remove('btn-submit');
          showBulkAddUnitFormBtn.classList.add('btn-outline');
      }
      if (showImportCsvFormBtn) {
          showImportCsvFormBtn.classList.remove('btn-submit');
          showImportCsvFormBtn.classList.add('btn-outline');
      }
  }

  // Initially hide all sub-sections and reset button styles
  if (unitFormSection) unitFormSection.style.display = 'none';
  if (bulkUnitFormSection) bulkUnitFormSection.style.display = 'none';
  if (importCsvFormSection) importCsvFormSection.style.display = 'none';
  resetUnitFormButtons();

  // Show/hide the add unit form
  if (showAddUnitFormBtn && unitFormSection && bulkUnitFormSection) {
      showAddUnitFormBtn.addEventListener('click', () => {
          if (unitFormSection.style.display === 'block') {
              unitFormSection.style.display = 'none';
              showAddUnitFormBtn.classList.remove('btn-submit');
              showAddUnitFormBtn.classList.add('btn-outline');
          } else {
              unitFormSection.style.display = 'block';
              bulkUnitFormSection.style.display = 'none';
              importCsvFormSection.style.display = 'none';
              
              showAddUnitFormBtn.classList.remove('btn-outline');
              showAddUnitFormBtn.classList.add('btn-submit');
              
              showBulkAddUnitFormBtn.classList.remove('btn-submit');
              showBulkAddUnitFormBtn.classList.add('btn-outline');
          }
          showImportCsvFormBtn.classList.remove('btn-submit');
          showImportCsvFormBtn.classList.add('btn-outline');

      });
  }

  if (cancelUnitFormBtn && unitFormSection) {
      cancelUnitFormBtn.addEventListener('click', () => {
          unitFormSection.style.display = 'none';
          addUnitForm.reset();
          unitTypeInput.value = '';
          unitTypeButtons.forEach(btn => btn.classList.remove('active'));
          resetUnitFormButtons(); // Reset both buttons
      });
  }

  if (unitTypeButtons && unitTypeInput) {
      unitTypeButtons.forEach(btn => {
          btn.addEventListener('click', () => {
              unitTypeButtons.forEach(other => other.classList.remove('active'));
              btn.classList.add('active');
              unitTypeInput.value = btn.getAttribute('data-value');
          });
      });
  }

  // NEW: Event listener for "Bulk eenheden toevoegen"
  if (showBulkAddUnitFormBtn && bulkUnitFormSection && unitFormSection) {
      showBulkAddUnitFormBtn.addEventListener('click', () => {
          if (bulkUnitFormSection.style.display === 'block') {
              bulkUnitFormSection.style.display = 'none';
              showBulkAddUnitFormBtn.classList.remove('btn-submit');
              showBulkAddUnitFormBtn.classList.add('btn-outline');
          } else {
              bulkUnitFormSection.style.display = 'block';
              unitFormSection.style.display = 'none';
              bulkAddUnitForm.reset();
              
              showBulkAddUnitFormBtn.classList.remove('btn-outline');
              showBulkAddUnitFormBtn.classList.add('btn-submit');
              
              showAddUnitFormBtn.classList.remove('btn-submit');
              showAddUnitFormBtn.classList.add('btn-outline');

              showImportCsvFormBtn.classList.remove('btn-submit');
              showImportCsvFormBtn.classList.add('btn-outline');
          }
      });
  }

  // NEW: Modify cancelBulkAddUnitFormBtn
  if (cancelBulkAddUnitFormBtn && bulkUnitFormSection) {
      cancelBulkAddUnitFormBtn.addEventListener('click', () => {
          bulkUnitFormSection.style.display = 'none';
          bulkAddUnitForm.reset();
          resetUnitFormButtons(); // Reset both buttons
      });
  }

  // CSV Import Logic
  if (showImportCsvFormBtn && importCsvFormSection) {
      showImportCsvFormBtn.addEventListener('click', () => {
          if (importCsvFormSection.style.display === 'block') {
              importCsvFormSection.style.display = 'none';
              resetUnitFormButtons();
          } else {
              importCsvFormSection.style.display = 'block';
              unitFormSection.style.display = 'none';
              bulkUnitFormSection.style.display = 'none';
              showImportCsvFormBtn.classList.add('btn-submit');
              showImportCsvFormBtn.classList.remove('btn-outline');
              showAddUnitFormBtn.classList.remove('btn-submit');
              showAddUnitFormBtn.classList.add('btn-outline');
              showBulkAddUnitFormBtn.classList.remove('btn-submit');
              showBulkAddUnitFormBtn.classList.add('btn-outline');
          }
      });
  }

  if (cancelImportCsvFormBtn && importCsvFormSection) {
      cancelImportCsvFormBtn.addEventListener('click', () => {
          importCsvFormSection.style.display = 'none';
          importCsvForm.reset();
          resetUnitFormButtons();
      });
  }

  if (importCsvForm) {
      importCsvForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const fileInput = document.getElementById('csvFileInput');
          if (!fileInput.files.length) return showToast('Selecteer eerst een CSV-bestand.', true);
          const file = fileInput.files[0];
          const reader = new FileReader();
          reader.onload = function(event) {
              const text = event.target.result;
              processCSV(text);
          };
          reader.readAsText(file);
      });
  }

  const downloadCsvTemplateBtn = document.getElementById('downloadCsvTemplate');
  if (downloadCsvTemplateBtn) {
      downloadCsvTemplateBtn.addEventListener('click', (e) => {
          e.preventDefault();
          const headers = "Roepnummer;Soort;Locatie;Naam1;Naam2;Naam3;GekoppeldAanPost;iPadnr;Tasnummer;RadioId";
          const exampleRow = "BLS-01;BLS;Post 1;Jan Jansen;Piet Puk;;;;;";
          const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(headers + "\n" + exampleRow);
          const link = document.createElement("a");
          link.setAttribute("href", csvContent);
          link.setAttribute("download", "rooster_sjabloon.csv");
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
      });
  }

  // Handle formulier inzending
  if (addUnitForm) {
      addUnitForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const fd = new FormData(addUnitForm);
          
          const newUnit = {
              id: fd.get('roepnummer').trim(),
              type: fd.get('soort'),
              location: fd.get('locatie').trim() || '-',
              naam1: fd.get('naam1').trim() || '',
              naam2: fd.get('naam2').trim() || '',
              naam3: fd.get('naam3').trim() || '',
              status: fd.get('status'),
              gekoppeldAanPost: fd.get('gekoppeldAanPost').trim() || '',
              ondersteunend: fd.get('soort') === 'Ondersteunend',
              ipadnr: fd.get('ipadnr').trim() || '',
              tasnummer: fd.get('tasnummer').trim() || '',
              radioId: fd.get('radioId').trim() || ''
          };

          if (!newUnit.type) {
              alert('Kies eerst een eenheidstype.');
              return;
          }

          // Check of roepnummer al bestaat
          if (units.find(u => u.id === newUnit.id)) {
              alert('Eenheid met roepnummer "' + newUnit.id + '" bestaat al!');
              return;
          }

          // Voeg eenheid toe
          units.push(newUnit);
          setDoc(doc(db, "units", newUnit.id), newUnit);
          
          // Update UI
          renderUnits();
          renderTables();
          renderDetailedUnitsTable();
          
          // Reset formulier
          addUnitForm.reset();
          showToast('Eenheid "' + newUnit.id + '" succesvol toegevoegd!');
      });
  }

  // ==========================================
  // GEDETAILLEERD EENHEDEN OVERZICHT TABEL
  // ==========================================
  function renderDetailedUnitsTable() {
      const tbody = document.getElementById('detailedUnitsTableBody');
      if (!tbody) return;

      if (units.length === 0) {
          tbody.innerHTML = '<tr><td colspan="13" class="empty-table-msg">Geen eenheden geregistreerd</td></tr>';
          return;
      }

      tbody.innerHTML = units.map(u => {
          // Gebruik de bestaande styling-functie zodat de kleur altijd perfect overeenkomt met de rechterbalk
          const style = getStatusStyle(u.status);
          const statusIcon = `<span class="unit-dot ${style.dot}" title="${u.status}" style="display:inline-block; vertical-align: middle;"></span>`;

          const getEditableSpan = (field, value) => `
              <span class="editable-field" data-id="${u.id}" data-field="${field}" data-value="${value || ''}">
                  ${value && value.toString().trim() !== '' ? value : '<i>Niet ingevuld</i>'}
              </span>
          `;
          
          const statusDropdown = `
              <select class="unit-status-select-detail ${style.bg}" data-unit-id="${u.id}">
                <option value="uitgerukt" ${u.status === 'uitgerukt' ? 'selected' : ''}>uitgerukt</option>
                <option value="vertrek patiënt" ${u.status === 'vertrek patiënt' ? 'selected' : ''}>vertrek patiënt</option>
                <option value="inzetbaar" ${u.status === 'inzetbaar' ? 'selected' : ''}>inzetbaar</option>
                <option value="retour post" ${u.status === 'retour post' ? 'selected' : ''}>retour post</option>
                <option value="op post" ${u.status === 'op post' ? 'selected' : ''}>op post</option>
                <option value="pauze" ${u.status === 'pauze' ? 'selected' : ''}>pauze</option>
                <option value="uitgemeld" ${u.status === 'uitgemeld' ? 'selected' : ''}>uitgemeld</option>
              </select>
          `;

          return `
              <tr>
                  <td>${statusIcon}</td>
                  <td><a href="#" class="log-unit-link" data-id="${u.id}" style="color:var(--text1); font-weight:600; text-decoration:none;">${u.id}</a></td>
                  <td>${getEditableSpan('type', u.type)}</td>
                  <td>${getEditableSpan('location', u.location)}</td>
                  <td>${getEditableSpan('naam1', u.naam1)}</td>
                  <td>${getEditableSpan('naam2', u.naam2)}</td>
                  <td>${getEditableSpan('naam3', u.naam3)}</td>
                  <td>${getEditableSpan('gekoppeldAanPost', u.gekoppeldAanPost)}</td>
                  <td>${u.ondersteunend ? 'Ja' : 'Nee'}</td>
                  <td>${statusDropdown}</td>
                  <td>${getEditableSpan('ipadnr', u.ipadnr)}</td>
                  <td>${getEditableSpan('tasnummer', u.tasnummer)}</td>
                  <td>${getEditableSpan('radioId', u.radioId)}</td>
              </tr>
          `;
      }).join('');

      // Attach editable field logic after rendering
      attachEditableFieldHandlers();
      
      // Koppel event listeners voor de status dropdown in deze tabel
      document.querySelectorAll('.unit-status-select-detail').forEach(select => {
          select.addEventListener('change', (e) => {
              const unitId = e.target.getAttribute('data-unit-id');
              const newStatus = e.target.value;
              const unitIndex = units.findIndex(u => u.id === unitId);
              if (unitIndex !== -1) {
                  units[unitIndex].status = newStatus;
                  
                  // Update locatie naar gekoppelde post bij 'retour post' of 'op post'
                  if ((newStatus === 'retour post' || newStatus === 'op post') && units[unitIndex].gekoppeldAanPost) {
                      units[unitIndex].location = units[unitIndex].gekoppeldAanPost;
                  }
                  
                  setDoc(doc(db, "units", units[unitIndex].id), units[unitIndex]);
                  addLog('Status', `Status gewijzigd naar: ${newStatus}`, units[unitIndex].id, '', '');
                  renderUnits();
                  renderDetailedUnitsTable(); // Herlaad tabel om kleuren bij te werken
              }
          });
      });
  }

  // Function to attach/re-attach editable field event handlers
  function attachEditableFieldHandlers() {
      $(document).off("click", ".editable-field"); // Prevent multiple bindings
      $(document).on("click", ".editable-field", function(e) {
          e.stopPropagation();
          var $span = $(this);
          if ($span.find("input").length > 0 || $span.find("select").length > 0) return; // already editing

          var currentText = $span.attr("data-value") || "";
          var unitId = $span.data("id");
          var field = $span.data("field");

          var $input;
          if (field === 'gekoppeldAanPost') {
              $input = $("<select>", {
                  class: "edit-field-input",
                  style: "width: 140px; font-size: 13px; padding: 4px; border: 1px solid var(--green); border-radius: 4px; background: var(--bg0); color: var(--text1); outline: none;"
              });
              
              let foundCurrent = false;
              $input.append($("<option>", { value: '', text: '-- Selecteer post --' }));
              
              posts.forEach(p => {
                  let isSelected = (p.naam === currentText);
                  if (isSelected) foundCurrent = true;
                  $input.append($("<option>", { value: p.naam, text: p.naam, selected: isSelected }));
              });
              
              if (!foundCurrent && currentText && currentText.trim() !== '' && currentText !== 'Onbekend') {
                  $input.prepend($("<option>", { value: currentText, text: currentText + ' (Huidig)', selected: true }));
              }
          } else {
              $input = $("<input>", {
                  type: "text",
                  value: currentText,
                  class: "edit-field-input",
                  style: "width: 100px; font-size: 13px; padding: 4px; border: 1px solid var(--green); border-radius: 4px; background: var(--bg0); color: var(--text1); outline: none;"
              });

              // Voor kleinere cellen zoals iPadnr, Tasnummer of Radio ID
              if (field === 'radioId' || field === 'tasnummer' || field === 'ipadnr') { 
                   $input.css("width", "60px");
              }
          }

          var $saveBtn = $("<button>", { html: '&#10004;', style: "margin-left:6px; cursor:pointer; background:var(--green); color:#fff; border:none; border-radius:4px; padding:3px 8px; font-size:12px;" });
          var $cancelBtn = $("<button>", { html: '&#10006;', style: "margin-left:4px; cursor:pointer; background:var(--red); color:#fff; border:none; border-radius:4px; padding:3px 8px; font-size:12px;" });

          $span.empty().append($input).append($saveBtn).append($cancelBtn);
          $input.focus();
          if ($input.is("input")) {
              $input.select();
          }

          var restore = function() {
               var val = $span.attr("data-value");
               if (val !== undefined && val.toString().trim() !== "") {
                   $span.text(val);
               } else {
                   $span.html("<i>Niet ingevuld</i>");
               }
          };

          var save = function() {
              var newVal = $input.val();
              if (field === 'radioId' && newVal && !/^\d+$/.test(newVal)) {
                  showToast("Portofoon nummer moet een getal zijn.", true);
                  restore();
                  return;
              }
              const unitIndex = units.findIndex(u => u.id === unitId);
              if (unitIndex !== -1) {
                  const oldValue = units[unitIndex][field];
                  units[unitIndex][field] = newVal;
                  setDoc(doc(db, "units", units[unitIndex].id), units[unitIndex]);
                  
                  if (oldValue !== newVal) {
                      const fieldNames = { 'type': 'soort', 'location': 'locatie', 'naam1': 'naam medewerker 1', 'naam2': 'naam medewerker 2', 'naam3': 'naam medewerker 3', 'gekoppeldAanPost': 'gekoppeld aan post', 'ipadnr': 'ipadnr', 'tasnummer': 'tasnummer', 'radioId': 'radioid' };
                      const fieldNameNL = fieldNames[field] || field;
                      addLog('Wijziging', `${fieldNameNL} gewijzigd van '${oldValue || 'niets'}' in '${newVal || 'niets'}'`, unitId, '', units[unitIndex].location);
                  }
                  
                  renderUnits(); // Update right panel
                  renderDetailedUnitsTable(); // Update detailed table
                  showToast(`Eenheid ${unitId} bijgewerkt.`);
              }
              restore();
          };

          $saveBtn.click(function(e) { e.stopPropagation(); save(); });
          $cancelBtn.click(function(e) { e.stopPropagation(); restore(); });
          $input.keypress(function(e) {
              if (e.which == 13) {
                  e.preventDefault();
                  save();
              }
          });
          $input.click(function(e) { e.stopPropagation(); });
      });
  }

  // ==========================================
  // BULK EENHEDEN TOEVOEGEN FORMULIER
  // ==========================================
  if (bulkAddUnitForm) {
      bulkAddUnitForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const fd = new FormData(bulkAddUnitForm);
          const blsCount = parseInt(fd.get('blsCount') || '0');
          const brandwachtCount = parseInt(fd.get('brandwachtCount') || '0');
          const alsCount = parseInt(fd.get('alsCount') || '0');

          let newUnitsAdded = 0;

          // Determine starting numbers for BLS and ALS
          let maxBlsNum = 0;
          let maxAlsNum = 0;
          let maxBwNum = 0;
          units.forEach(u => {
              if (u.type === 'BLS' && u.id.startsWith('BLS-')) {
                  const num = parseInt(u.id.substring(4));
                  if (!isNaN(num) && num > maxBlsNum) maxBlsNum = num;
              } else if (u.type === 'ALS' && u.id.startsWith('ALS-')) {
                  const num = parseInt(u.id.substring(4));
                  if (!isNaN(num) && num > maxAlsNum) maxAlsNum = num;
              } else if (u.type === 'Brandwacht' && u.id.startsWith('BW-')) {
                  const num = parseInt(u.id.substring(3));
                  if (!isNaN(num) && num > maxBwNum) maxBwNum = num;
              }
          });

          for (let i = 0; i < blsCount; i++) {
              maxBlsNum++;
              const newUnitId = `BLS-${String(maxBlsNum).padStart(2, '0')}`;
              if (!units.find(u => u.id === newUnitId)) { // Ensure uniqueness
                  const newUnit = {
                      id: newUnitId,
                      type: 'BLS',
                      location: 'Onbekend',
                      naam1: '', naam2: '', naam3: '',
                      status: 'inzetbaar',
                      gekoppeldAanPost: '',
                      ondersteunend: false,
                      ipadnr: '', tasnummer: '', radioId: ''
                  };
                  units.push(newUnit);
                  setDoc(doc(db, "units", newUnit.id), newUnit); // ✅ FIX: Sla op in Firebase!
                  newUnitsAdded++;
              }
          }

          for (let i = 0; i < alsCount; i++) {
              maxAlsNum++;
              const newUnitId = `ALS-${String(maxAlsNum).padStart(2, '0')}`;
              if (!units.find(u => u.id === newUnitId)) { // Ensure uniqueness
                  const newUnit = {
                      id: newUnitId,
                      type: 'ALS',
                      location: 'Onbekend',
                      naam1: '', naam2: '', naam3: '',
                      status: 'inzetbaar',
                      gekoppeldAanPost: '',
                      ondersteunend: false,
                      ipadnr: '', tasnummer: '', radioId: ''
                  };
                  units.push(newUnit);
                  setDoc(doc(db, "units", newUnit.id), newUnit); // ✅ FIX: Sla op in Firebase!
                  newUnitsAdded++;
              }
          }

          for (let i = 0; i < brandwachtCount; i++) {
              maxBwNum++;
              const newUnitId = `BW-${String(maxBwNum).padStart(2, '0')}`;
              if (!units.find(u => u.id === newUnitId)) { // Ensure uniqueness
                  const newUnit = {
                      id: newUnitId,
                      type: 'Brandwacht',
                      location: 'Onbekend',
                      naam1: '', naam2: '', naam3: '',
                      status: 'inzetbaar',
                      gekoppeldAanPost: '',
                      ondersteunend: false,
                      ipadnr: '', tasnummer: '', radioId: ''
                  };
                  units.push(newUnit);
                  setDoc(doc(db, "units", newUnit.id), newUnit); // ✅ FIX: Sla op in Firebase!
                  newUnitsAdded++;
              }
          }


          if (newUnitsAdded > 0) {
              renderUnits();
              renderTables();
              renderDetailedUnitsTable();
              showToast(`${newUnitsAdded} eenheden succesvol toegevoegd!`);
          } else {
              showToast('Geen nieuwe eenheden toegevoegd.', true);
          }
          
          bulkAddUnitForm.reset();
      });
  }
  
  function processCSV(csvText) {
      const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
      if (lines.length < 2) return showToast('CSV-bestand is leeg of bevat alleen een kopregel.', true); 

      const headers = lines[0].split(';').map(h => h.trim());
      const requiredHeaders = ['Roepnummer', 'Soort']; 
      if (!requiredHeaders.every(h => headers.includes(h))) {
          return showToast(`CSV-bestand mist verplichte kolommen: ${requiredHeaders.join(', ')}.`, true);
      }

      let updatedCount = 0;
      let createdCount = 0;

      for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(';');
          const row = headers.reduce((obj, header, index) => {
              obj[header] = values[index] ? values[index].trim() : '';
              return obj;
          }, {});

          const unitId = row['Roepnummer'];
          if (!unitId) continue;

          const existingUnitIndex = units.findIndex(u => u.id === unitId);

          const unitData = {
              id: unitId,
              type: row['Soort'] || 'Onbekend',
              location: row['Locatie'] || 'Onbekend',
              naam1: row['Naam1'] || '',
              naam2: row['Naam2'] || '',
              naam3: row['Naam3'] || '',
              status: 'inzetbaar', // Default status
              gekoppeldAanPost: row['GekoppeldAanPost'] || '',
              ondersteunend: (row['Soort'] || '').toLowerCase() === 'ondersteunend',
              ipadnr: row['iPadnr'] || '',
              tasnummer: row['Tasnummer'] || '',
              radioId: row['RadioId'] || ''
          };

          if (existingUnitIndex > -1) {
              // Update existing unit: behoud de live status, importeer geen default die een actieve inzet overschrijft
              const { status, ...unitDataNoStatus } = unitData;
              units[existingUnitIndex] = { ...units[existingUnitIndex], ...unitDataNoStatus };
              setDoc(doc(db, "units", unitId), units[existingUnitIndex]);
              updatedCount++;
          } else {
              // Create new unit
              units.push(unitData);
              setDoc(doc(db, "units", unitId), unitData);
              createdCount++;
          }
      }

      renderUnits();
      renderDetailedUnitsTable();
      showToast(`Import voltooid: ${createdCount} eenheden aangemaakt, ${updatedCount} eenheden bijgewerkt.`);
      importCsvFormSection.style.display = 'none';
      importCsvForm.reset();
      resetUnitFormButtons();
  }

  // ==========================================
  // SORTEREN VAN EENHEDEN
  // ==========================================
  let currentSort = { col: 'id', asc: true };

  function sortUnits(col, keepDirection = false) {
      if (!keepDirection) {
          if (currentSort.col === col) {
          currentSort.asc = !currentSort.asc;
          } else {
          currentSort.col = col;
          currentSort.asc = true;
          }
      }

      units.sort((a, b) => {
          let valA = a[col] ? a[col].toString().toLowerCase() : '';
          let valB = b[col] ? b[col].toString().toLowerCase() : '';

          // Intelligente sortering voor roepnummers met getallen (zodat ALS-2 vóór ALS-10 komt)
          if (col === 'id') {
               const matchA = valA.match(/^([a-z-]+)(\d+)$/i);
               const matchB = valB.match(/^([a-z-]+)(\d+)$/i);
               if (matchA && matchB && matchA[1] === matchB[1]) {
                   return currentSort.asc ? parseInt(matchA[2]) - parseInt(matchB[2]) : parseInt(matchB[2]) - parseInt(matchA[2]);
               }
          }
          if (valA < valB) return currentSort.asc ? -1 : 1;
          if (valA > valB) return currentSort.asc ? 1 : -1;
          return 0;
      });

      renderDetailedUnitsTable();
      renderUnits();
      
      // Update pijltjes in de kolomkoppen
      document.querySelectorAll('.sort-header .sort-icon').forEach(icon => icon.textContent = '↕');
      const activeHeader = document.querySelector(`.sort-header[data-sort="${col}"] .sort-icon`);
      if (activeHeader) activeHeader.textContent = currentSort.asc ? '↓' : '↑';
  }

  // Koppel de sorteer-knoppen aan de tabel
  document.addEventListener('click', function(e) {
      const header = e.target.closest('.sort-header');
      if (header) {
          sortUnits(header.getAttribute('data-sort'));
      }
  });

  // ==========================================
  // POSTEN BEHEER LOGICA
  // ==========================================
  const addPostForm = document.getElementById('addPostForm');
  const showAddPostFormBtn = document.getElementById('showAddPostFormBtn');
  const postFormSection = document.getElementById('postFormSection');
  const cancelPostFormBtn = document.getElementById('cancelPostFormBtn');

  if (showAddPostFormBtn && postFormSection) {
      showAddPostFormBtn.addEventListener('click', () => {
          if (postFormSection.style.display === 'block') {
              postFormSection.style.display = 'none';
              showAddPostFormBtn.classList.remove('btn-submit');
              showAddPostFormBtn.classList.add('btn-outline');
          } else {
              postFormSection.style.display = 'block';
              showAddPostFormBtn.classList.remove('btn-outline');
              showAddPostFormBtn.classList.add('btn-submit');
          }
      });
  }
  if (cancelPostFormBtn && postFormSection) {
      cancelPostFormBtn.addEventListener('click', () => {
          postFormSection.style.display = 'none';
          addPostForm.reset();
          showAddPostFormBtn.classList.remove('btn-submit');
          showAddPostFormBtn.classList.add('btn-outline');
      });
  }
  if (addPostForm) {
      addPostForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const fd = new FormData(addPostForm);
          const newPost = {
              id: 'P-' + Date.now() + '-' + Math.floor(Math.random() * 999),
              naam: fd.get('naam').trim(),
              locatie: fd.get('locatie').trim(),
              postcoordinator: fd.get('postcoordinator') ? fd.get('postcoordinator').trim() : '',
              status: fd.get('status')
          };
          posts.push(newPost);
          setDoc(doc(db, "posts", newPost.id), newPost);
          renderPosts();
          renderDetailedPostsTable();
          addPostForm.reset();
          postFormSection.style.display = 'none';
          showAddPostFormBtn.classList.remove('btn-submit');
          showAddPostFormBtn.classList.add('btn-outline');
          showToast('Post "' + newPost.naam + '" succesvol toegevoegd!');
      });
  }

  function renderDetailedPostsTable() {
      const tbody = document.getElementById('detailedPostsTableBody');
      if (!tbody) return;
      if (posts.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" class="empty-table-msg">Geen posten geregistreerd</td></tr>';
          return;
      }
      tbody.innerHTML = posts.map(p => {
          const style = getPostStatusStyle(p.status);
          const statusIcon = `<span class="unit-dot ${style.dot}" title="${p.status}" style="display:inline-block; vertical-align: middle;"></span>`;
          const getEditableSpan = (field, value) => `<span class="editable-post-field" data-id="${p.id}" data-field="${field}" data-value="${value || ''}">${value && value.toString().trim() !== '' ? value : '<i>Niet ingevuld</i>'}</span>`;
          const statusDropdown = `<select class="status-dropdown-base post-status-select-detail ${style.bg}" data-id="${p.id}"><option value="open" ${p.status === 'open' ? 'selected' : ''}>open</option><option value="gesloten" ${p.status === 'gesloten' ? 'selected' : ''}>gesloten</option></select>`;
          
          // Bereken welke eenheden gekoppeld zijn aan deze specifieke post
          const linkedUnitsList = units.filter(u => u.gekoppeldAanPost && u.gekoppeldAanPost.toLowerCase() === p.naam.toLowerCase()).map(u => `<li style="color:var(--blue);font-weight:600;">${u.id}</li>`).join('');
          const linkedUnitsHTML = linkedUnitsList ? `<ul style="margin:0; padding-left:16px;">${linkedUnitsList}</ul>` : '-';

          return `
            <tr data-post-name="${p.naam}">
              <td>${statusIcon}</td>
              <td>${getEditableSpan('naam', p.naam)}</td>
              <td>${getEditableSpan('locatie', p.locatie)}</td>
              <td>${getEditableSpan('postcoordinator', p.postcoordinator)}</td>
              <td>${statusDropdown}</td>
              <td>${linkedUnitsHTML}</td>
              <td><button type="button" class="btn btn-outline" data-delete-post="${p.id}" style="padding:6px 12px;font-size:12px;">Verwijderen</button></td>
            </tr>`;
      }).join('');

      $(document).off("click", ".editable-post-field"); 
      $(document).on("click", ".editable-post-field", function(e) {
          e.stopPropagation();
          var $span = $(this);
          if ($span.find("input").length > 0) return; 
          var currentText = $span.attr("data-value") || "";
          var postId = $span.data("id");
          var field = $span.data("field");
          var $input = $("<input>", { type: "text", value: currentText, class: "edit-field-input", style: "width: 120px; font-size: 13px; padding: 4px; border: 1px solid var(--green); border-radius: 4px; background: var(--bg0); color: var(--text1); outline: none;" });
          var $saveBtn = $("<button>", { html: '&#10004;', style: "margin-left:6px; cursor:pointer; background:var(--green); color:#fff; border:none; border-radius:4px; padding:3px 8px; font-size:12px;" });
          var $cancelBtn = $("<button>", { html: '&#10006;', style: "margin-left:4px; cursor:pointer; background:var(--red); color:#fff; border:none; border-radius:4px; padding:3px 8px; font-size:12px;" });
          $span.empty().append($input).append($saveBtn).append($cancelBtn);
          $input.focus().select();
          var restore = function() { var val = $span.attr("data-value"); if (val && val.toString().trim() !== "") { $span.text(val); } else { $span.html("<i>Niet ingevuld</i>"); } };
          var save = function() {
              var newVal = $input.val();
              const postIndex = posts.findIndex(x => x.id === postId);
              if (postIndex !== -1) { 
                  const oldValue = posts[postIndex][field];
                  posts[postIndex][field] = newVal; 
                  setDoc(doc(db, "posts", posts[postIndex].id), posts[postIndex]); 
                  if (oldValue !== newVal) {
                      addLog('Wijziging', `${field} gewijzigd van '${oldValue || 'niets'}' in '${newVal || 'niets'}'`, '', '', posts[postIndex].locatie);
                  }
                  renderPosts(); renderDetailedPostsTable(); showToast(`Post bijgewerkt.`); 
              }
              restore();
          };
          $saveBtn.click(function(e) { e.stopPropagation(); save(); });
          $cancelBtn.click(function(e) { e.stopPropagation(); restore(); });
          $input.keypress(function(e) { if (e.which == 13) { e.preventDefault(); save(); } });
          $input.click(function(e) { e.stopPropagation(); });
      });

      document.querySelectorAll('.post-status-select-detail').forEach(select => {
          select.addEventListener('change', (e) => {
              const postId = e.target.getAttribute('data-id');
              const postIndex = posts.findIndex(x => x.id === postId);
              if (postIndex !== -1) { posts[postIndex].status = e.target.value; setDoc(doc(db, "posts", posts[postIndex].id), posts[postIndex]); renderPosts(); renderDetailedPostsTable(); }
          });
      });
      document.querySelectorAll('[data-delete-post]').forEach(btn => {
          btn.addEventListener('click', () => {
              const postId = btn.getAttribute('data-delete-post');
              const idx = posts.findIndex(x => x.id === postId);
              if (idx !== -1) { posts.splice(idx, 1); deleteDoc(doc(db, "posts", postId)); renderPosts(); renderDetailedPostsTable(); }
          });
      });

      // Drag & Drop eenheden naar Posten (Tabel)
      document.querySelectorAll('#detailedPostsTableBody tr[data-post-name]').forEach(tr => {
          const postName = tr.getAttribute('data-post-name');
          tr.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tr.classList.add('drag-over'); });
          tr.addEventListener('dragleave', (e) => { tr.classList.remove('drag-over'); });
          tr.addEventListener('drop', (e) => {
              e.preventDefault();
              tr.classList.remove('drag-over');
              const unitId = e.dataTransfer.getData('text/plain');
              if (unitId) {
                  const unit = units.find(u => u.id === unitId);
                  if (unit) {
                      unit.gekoppeldAanPost = postName;
                      setDoc(doc(db, "units", unit.id), unit);
                      showToast(`Eenheid ${unitId} direct gekoppeld aan post ${postName}`);
                      renderDetailedPostsTable();
                      renderUnits();
                      if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
                  }
              }
          });
      });
  }

  let currentPostSort = { col: 'naam', asc: true };
  function sortPosts(col, keepDirection = false) {
      if (!keepDirection) { if (currentPostSort.col === col) { currentPostSort.asc = !currentPostSort.asc; } else { currentPostSort.col = col; currentPostSort.asc = true; } }
      posts.sort((a, b) => {
          let valA = a[col] ? a[col].toString().toLowerCase() : '';
          let valB = b[col] ? b[col].toString().toLowerCase() : '';
          if (valA < valB) return currentPostSort.asc ? -1 : 1;
          if (valA > valB) return currentPostSort.asc ? 1 : -1;
          return 0;
      });
      renderDetailedPostsTable();
      renderPosts();
      document.querySelectorAll('.sort-header-post .sort-icon-post').forEach(icon => icon.textContent = '↕');
      const activeHeader = document.querySelector(`.sort-header-post[data-sort="${col}"] .sort-icon-post`);
      if (activeHeader) activeHeader.textContent = currentPostSort.asc ? '↓' : '↑';
  }
  document.addEventListener('click', function(e) {
      const header = e.target.closest('.sort-header-post');
      if (header) sortPosts(header.getAttribute('data-sort'));
  });

  // Roep sorteerfunctie direct aan bij opstarten zodat alles alfabetisch is, dit activeert ook meteen renderUnits() etc.
  sortUnits('id', true); 
  sortPosts('naam', true);
  renderTables(); 
  refreshRowActions();

  // Setup all modals (except the new inline one)
  setupModal('brandwachtModal', 'btnBrandwacht', 'brandwachtForm');
  setupModal('logistiekModal', 'btnLogistiek', 'logistiekForm');

  document.getElementById('btnGlobalLog')?.addEventListener('click', () => {
    currentLogIncidentId = null; // Geen specifieke melding
    window.closeOtherInlinePanels('freeLogModal');
    document.getElementById('freeLogModal').classList.add('show');
  });
  
  // ==========================================
  // DIGITALE KLOK
  // ==========================================
  function updateClock() {
      const clockElement = document.getElementById('digitalClock');
      if (clockElement) {
          const now = new Date();
          const timeString = now.toLocaleTimeString('nl-NL', { hour12: false });
          clockElement.textContent = timeString;
      }
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ==========================================
  // BUIENRADAR / WEER MODAL
  // ==========================================
  const weatherModal = document.getElementById('weatherModal');
  const weatherCloseBtn = document.getElementById('weatherCloseBtn');
  const buienradarIframe = document.getElementById('buienradarIframe');

  async function fetchWeatherData(lat, lon, isFallback = false) {
      const locInfo = document.querySelector('#weatherLocationInfo span');
      const wTemp = document.getElementById('weatherTemp');
      const wWind = document.getElementById('weatherWind');
      const wWindDir = document.getElementById('weatherWindDir');
      const wRain = document.getElementById('weatherRain');
      const wGusts = document.getElementById('weatherGusts');
      const wApparent = document.getElementById('weatherApparentTemp');
      const wHumidity = document.getElementById('weatherHumidity');
      const wUV = document.getElementById('weatherUV');
      const wSun = document.getElementById('weatherSun');
      const hourlyContainer = document.getElementById('hourlyForecastContainer');
      const alertsContainer = document.getElementById('weatherAlertsContainer');
      
      buienradarIframe.src = `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=km%2Fh&zoom=10&overlay=rain&product=radar&level=surface&lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&marker=true`;
      locInfo.innerHTML = 'Locatiegegevens laden...';

      // Ophalen van de 5-minuten data via Buienradar API
      try {
          const brRes = await fetch(`https://gpsgadget.buienradar.nl/data/raintext?lat=${lat}&lon=${lon}`);
          const brText = await brRes.text();
          const lines = brText.trim().split('\n');
          
          const chartContainer = document.getElementById('rainChartContainer');
          const labelsContainer = document.getElementById('rainChartLabels');
          let chartHtml = '';
          let labelsHtml = '';
          
          if (lines.length > 0 && lines[0] !== '') {
              lines.forEach((line, index) => {
                  const parts = line.split('|');
                  if (parts.length === 2) {
                      const val = parseInt(parts[0], 10);
                      const time = parts[1];
                      
                      // Hoogte berekenen (max 255 in theorie)
                      let h = (val / 255) * 100;
                      if (val > 0 && h < 4) h = 4; // Zorg dat ook een klein beetje regen zichtbaar is
                      
                      let category = 'Droog';
                      let color = 'transparent';
                      if (val > 0) {
                         if (val < 77) { category = 'Lichte regen'; color = 'var(--blue)'; }
                         else if (val < 130) { category = 'Matige regen'; color = 'var(--purple)'; }
                         else { category = 'Zware regen'; color = 'var(--red)'; }
                      }
                      
                      chartHtml += `<div title="${time} - ${category}" style="flex: 1; height: 100%; display: flex; align-items: flex-end; cursor: pointer;">
                          <div style="width: 100%; background-color: ${color}; height: ${h}%; border-radius: 2px 2px 0 0; transition: height 0.3s; opacity: 0.85;"></div>
                      </div>`;
                      
                      // Een label per 30 minuten (elke 6e indexing)
                      if (index % 6 === 0) labelsHtml += `<span style="flex: 1; text-align: ${index === 0 ? 'left' : (index >= 24 ? 'right' : 'center')};">${time}</span>`;
                  }
              });
              chartContainer.innerHTML = chartHtml;
              labelsContainer.innerHTML = labelsHtml;
          } else {
              chartContainer.innerHTML = '<div style="color: var(--text3); font-size: 13px;">Geen regen verwacht.</div>';
          }
      } catch (e) {
          console.error("Fout bij laden 5-minuten regen:", e);
          document.getElementById('rainChartContainer').innerHTML = '<div style="color: var(--text3); font-size: 13px;">Regengrafiek kon niet geladen worden.</div>';
      }

      try {
          const nomRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
          const nomData = await nomRes.json();
          let locationName = "Onbekende locatie";
          if (nomData && nomData.address) {
              locationName = nomData.address.city || nomData.address.town || nomData.address.village || nomData.address.municipality || "Gevonden locatie";
          }
          if (isFallback) {
              locInfo.innerHTML = `<span style="color: var(--amber);">Locatie geweigerd, toont standaard (Utrecht)</span>`;
          } else {
              locInfo.innerHTML = `Huidige locatie: <strong style="color:var(--text1);">${locationName}</strong>`;
          }

          const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_gusts_10m&daily=sunrise,sunset&timezone=Europe%2FAmsterdam&forecast_days=2`);
          const wData = await weatherRes.json();
          
          if (wData && wData.current) {
              wTemp.textContent = wData.current.temperature_2m + ' °C';
              const speedKmh = wData.current.wind_speed_10m;
              let bft = 0;
              if(speedKmh>=1&&speedKmh<=5) bft=1; else if(speedKmh<=11) bft=2; else if(speedKmh<=19) bft=3; else if(speedKmh<=28) bft=4; else if(speedKmh<=38) bft=5; else if(speedKmh<=49) bft=6; else if(speedKmh<=61) bft=7; else if(speedKmh<=74) bft=8; else if(speedKmh<=88) bft=9; else if(speedKmh<=102) bft=10; else if(speedKmh<=117) bft=11; else if(speedKmh>117) bft=12;
              wWind.textContent = bft + ' Bft';
              const deg = wData.current.wind_direction_10m;
              const dirs = ['N', 'NNO', 'NO', 'ONO', 'O', 'OZO', 'ZO', 'ZZO', 'Z', 'ZZW', 'ZW', 'WZW', 'W', 'WNW', 'NW', 'NNW'];
              wWindDir.textContent = 'Windrichting: ' + dirs[Math.floor((deg / 22.5) + 0.5) % 16];
              wRain.textContent = wData.current.precipitation + ' mm';
              wGusts.textContent = wData.current.wind_gusts_10m + ' km/u';

              wApparent.textContent = wData.current.apparent_temperature + ' °C';
              wHumidity.textContent = wData.current.relative_humidity_2m + ' %';
              wUV.textContent = wData.current.uv_index;

              // Zonsopkomst & -ondergang
              if (wData.daily && wData.daily.sunrise && wData.daily.sunset) {
                  const sr = new Date(wData.daily.sunrise[0]).toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'});
                  const ss = new Date(wData.daily.sunset[0]).toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'});
                  wSun.textContent = `${sr} / ${ss}`;
              }

              // Alerts genereren o.b.v. data
              let alerts = [];
              if (wData.current.temperature_2m >= 30 || wData.current.apparent_temperature >= 32) {
                  alerts.push({ level: 'Oranje', msg: 'Hitte: Gevaar voor hittestress en uitdroging.' });
              } else if (wData.current.temperature_2m >= 27) {
                  alerts.push({ level: 'Geel', msg: 'Hitte: Zeer warme omstandigheden.' });
              }
              
              if (wData.current.wind_gusts_10m >= 100) {
                  alerts.push({ level: 'Rood', msg: 'Zeer zware windstoten (> 100 km/u). Overweeg ontruimingsprotocol.' });
              } else if (wData.current.wind_gusts_10m >= 75) {
                  alerts.push({ level: 'Oranje', msg: 'Zware windstoten (> 75 km/u). Let op losse objecten en tenten.' });
              } else if (wData.current.wind_gusts_10m >= 50 || bft >= 6) {
                  alerts.push({ level: 'Geel', msg: 'Stevige windstoten. Beveilig lichte materialen en hekken.' });
              }
              
              if (wData.current.uv_index >= 7) {
                  alerts.push({ level: 'Geel', msg: 'Hoge UV-Index. Let op voldoende zonbescherming/schaduw voor bezoekers.' });
              }
              
              // Actuele en verwachte regen alerts
              if (wData.current.precipitation >= 10) {
                  alerts.push({ level: 'Rood', msg: 'Zware regenval actueel! Kans op wateroverlast op het terrein.' });
              } else if (wData.current.precipitation >= 3) {
                  alerts.push({ level: 'Oranje', msg: 'Stevige buien actueel. Houd afvoer en tenten in de gaten.' });
              }
              
              // Onweer alerts (WMO weather codes: 95 = onweer, 96/99 = zwaar onweer met hagel)
              if (wData.current.weather_code === 96 || wData.current.weather_code === 99) {
                  alerts.push({ level: 'Rood', msg: 'Zwaar onweer (met hagel) actueel! Zoek veilige schuilplaatsen.' });
              } else if (wData.current.weather_code === 95) {
                  alerts.push({ level: 'Oranje', msg: 'Onweer/Blikseminslag actueel! Houd de lucht en radar in de gaten.' });
              }

              if (wData.hourly && wData.hourly.time) {
                  const nowTime = new Date();
                  let maxRainNext3Hours = 0;
                  let expectThunder = false;
                  let checkedHours = 0;
                  for (let i = 0; i < wData.hourly.time.length; i++) {
                      const tDate = new Date(wData.hourly.time[i]);
                      if (tDate >= nowTime && checkedHours < 3) {
                          if (wData.hourly.precipitation[i] > maxRainNext3Hours) maxRainNext3Hours = wData.hourly.precipitation[i];
                          if (wData.hourly.weather_code && wData.hourly.weather_code[i] >= 95) expectThunder = true;
                          checkedHours++;
                      }
                  }
                  if (maxRainNext3Hours >= 5 && wData.current.precipitation < 3) {
                      alerts.push({ level: 'Geel', msg: 'Let op: Er worden binnenkort zware buien verwacht (> 5 mm/u).' });
                  }
                  if (expectThunder && wData.current.weather_code < 95) {
                      alerts.push({ level: 'Geel', msg: 'Let op: Er wordt onweer verwacht in de komende 3 uur.' });
                  }
              }

              if (alerts.length > 0) {
                  alertsContainer.style.display = 'flex';
                  alertsContainer.style.flexDirection = 'column';
                  alertsContainer.style.gap = '8px';
                  alertsContainer.innerHTML = alerts.map(a => {
                      const bg = a.level === 'Rood' ? 'var(--red-bg)' : (a.level === 'Oranje' ? 'var(--orange-bg)' : 'var(--amber-bg)');
                      const color = a.level === 'Rood' ? 'var(--red)' : (a.level === 'Oranje' ? 'var(--orange)' : 'var(--amber)');
                      return `<div style="background: ${bg}; color: ${color}; padding: 12px 16px; border-radius: 8px; border: 1px solid ${color}; font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 8px;">
                          <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                          Code ${a.level}: ${a.msg}
                      </div>`;
                  }).join('');
              } else {
                  alertsContainer.style.display = 'none';
                  alertsContainer.innerHTML = '';
              }

              // Uurlijkse Voorspelling (Komende 12 uur)
              if (wData.hourly && wData.hourly.time) {
                  const now = new Date();
                  now.setMinutes(0, 0, 0); // Rond af naar hudige uur
                  let hourlyHtml = '';
                  let count = 0;
                  for (let i = 0; i < wData.hourly.time.length; i++) {
                      const tDate = new Date(wData.hourly.time[i]);
                      if (tDate >= now && count < 12) {
                          const timeStr = tDate.toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'});
                          hourlyHtml += `<div style="flex: 0 0 auto; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; text-align: center; width: 95px;"><div style="font-size: 11px; font-weight: 600; color: var(--text3); margin-bottom: 6px;">${timeStr}</div><div style="font-size: 15px; font-weight: 700; color: var(--text1); margin-bottom: 4px;">${Math.round(wData.hourly.temperature_2m[i])}°C</div><div style="font-size: 11px; color: var(--blue);" title="Kans op neerslag">🌧️ ${wData.hourly.precipitation_probability[i]}%</div><div style="font-size: 10px; color: var(--blue); margin-bottom: 2px;" title="Verwachte hoeveelheid">💧 ${wData.hourly.precipitation[i]} mm</div><div style="font-size: 11px; color: var(--purple);" title="Windstoten in km/u">💨 ${Math.round(wData.hourly.wind_gusts_10m[i])}</div></div>`;
                          count++;
                      }
                  }
                  hourlyContainer.innerHTML = hourlyHtml;
              }
          }
      } catch (error) {
          console.error("Fout bij ophalen weer:", error);
          locInfo.innerHTML = 'Fout bij ophalen weergegevens.';
      }
  }

  async function updateWeatherButton(lat, lon) {
      const weatherBtnTemp = document.getElementById('weatherBtnTemp');
      if (!weatherBtnTemp) return;

      try {
          const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&timezone=Europe%2FAmsterdam`);
          const wData = await weatherRes.json();
          
          if (wData && wData.current) {
              const temp = Math.round(wData.current.temperature_2m);
              weatherBtnTemp.textContent = `${temp}°C`;
          }
      } catch (error) {
          console.warn("Kon temperatuur voor knop niet ophalen:", error);
      }
  }

  function initializeWeather() {
      if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
              (position) => {
                  updateWeatherButton(position.coords.latitude, position.coords.longitude);
              },
              () => { updateWeatherButton(52.09, 5.12); } // Fallback on error
          );
      } else {
          updateWeatherButton(52.09, 5.12); // Fallback if no geolocation
      }
  }

      weatherBtn?.addEventListener('click', () => {
          weatherModal.classList.add('show');
          if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(
                  (position) => {
                      fetchWeatherData(position.coords.latitude, position.coords.longitude, false);
                  },
                  (error) => {
                      console.warn('Locatie niet beschikbaar, standaard buienradar wordt getoond.');
                      fetchWeatherData(52.09, 5.12, true);
                  }
              );
          } else {
              fetchWeatherData(52.09, 5.12, true);
          }
      });

      if (weatherCloseBtn) {
          weatherCloseBtn.addEventListener('click', () => {
              weatherModal.classList.remove('show');
          });
      }

      const weatherPopoutBtn = document.getElementById('weatherPopoutBtn');
      if (weatherPopoutBtn) {
          weatherPopoutBtn.addEventListener('click', () => {
              window.open(window.location.pathname + '?popout=true&panel=weather', 'WeerPanel', 'width=900,height=700,left=200,top=200');
              weatherModal.classList.remove('show');
          });
      }

  // ==========================================
  // ZOOM FUNCTIE
  // ==========================================
  const zoomSelect = document.getElementById('zoomSelect'); // Already cached, but keep for clarity
  function applyZoom(zoomLevel) {
      document.body.style.zoom = zoomLevel;
  }
  if (zoomSelect) {
      zoomSelect.addEventListener('change', (e) => applyZoom(e.target.value));
      applyZoom(zoomSelect.value); // Pas de standaard weergave (75%) direct toe bij laden
  }

  if (forgotPasswordBtn) {
      forgotPasswordBtn.addEventListener('click', async () => {
          const email = loginUsername.value.trim();
          if (!email) {
              showToast('Vul eerst je e-mailadres in en klik dan op "Wachtwoord vergeten?".', true);
              return;
          }
          
          try {
              await sendPasswordResetEmail(auth, email);
              showToast(`Reset e-mail verstuurd naar ${email}.`);
          } catch (error) {
              console.error("Fout bij wachtwoord reset:", error);
              if (error.code === 'auth/invalid-email') {
                  showToast('Dit e-mailadres is ongeldig.', true);
              } else {
                  showToast('Er is geen account gevonden of er ging iets mis.', true);
              }
          }
      });
  }
  // ==========================================
  // PROTOCOLLEN LOGICA
  // ==========================================
  const protocols = {
      reanimatie: { titel: 'Reanimatie (BLS / AED)', inhoud: `<ol style="padding-left:20px;line-height:2"><li>Controleer bewustzijn — roep naam, schouder aanraken</li><li>Roep hulp — alarm slaan, AED ophalen</li><li>Controleer ademhaling max. 10 seconden</li><li>Start borstcompressies: 30x, 5–6 cm diep, 100–120/min</li><li>2 beademingen (indien getraind)</li><li>Wissel elke 2 minuten</li><li>Zodra AED aanwezig: aansluiten en instructies volgen</li></ol>` },
      ontruiming: { titel: 'Ontruiming / Calamiteit', inhoud: `<ol style="padding-left:20px;line-height:2"><li>Melding ontvangen van beveiliging of organisatie</li><li>Informeer alle posten via portofoon</li><li>Zet extra eenheden naar uitgangen</li><li>Houd centrale post bemand voor coördinatie</li><li>Registreer slachtoffers en vermisten</li><li>Wacht instructies van leidinggevende / brandweer</li></ol>` },
      agressie:   { titel: 'Agressie / Vechtpartij', inhoud: `<ol style="padding-left:20px;line-height:2"><li>Schakel beveiliging direct in</li><li>Houd afstand — ga niet zelf tussenbeide</li><li>Zorg voor vrije vluchtweg voor bezoekers</li><li>Registreer locatie en beschrijving dader(s)</li><li>Eerste hulp gereed houden voor eventuele slachtoffers</li><li>Informeer de organisatie en overweeg politie 112</li></ol>` },
      vermissing: { titel: 'Vermissing op evenementen', inhoud: `<h4 style="margin-bottom:10px; color:var(--text1);">Protocol Omgaan met Vermissingen op Evenementen (Versie 1, Nov 2024)</h4><p style="margin-bottom:10px;">Helaas komt het voor dat personen vermist raken op een evenement. Gelukkig is dit over het algemeen van korte duur, maar regelmatig wordt bij dergelijke gevallen contact gezocht met de EHBO. Hoewel de EHBO kan ondersteunen bij incidenten rondom vermiste personen, is het niet onze primaire taak om actieve zoekacties uit te voeren. Onze hoofdverantwoordelijkheid ligt bij het verlenen van eerste hulp, en actieve zoektochten kunnen deze taak belemmeren.</p><p style="margin-bottom:15px;">Er zijn echter een aantal zaken die wij kunnen doen om te helpen. Door deze richtlijnen te volgen, kunnen we op een effectieve en professionele manier omgaan met vermissingen tijdens evenementen, zonder dat dit ten koste gaat van onze primaire taak.</p><h5 style="margin-bottom:5px; font-size:13px; color:var(--blue);">Gegevens</h5><p style="margin-bottom:5px;">Gegevens die handig zijn om te weten:</p><ol style="padding-left:20px; margin-bottom:10px;"><li>Naam & Geboortedatum</li><li>Recente foto die gedeeld kan/mag worden</li><li>Uiterlijke kenmerken & Kleding</li><li>Omschrijving van de situatie (Laatst gezien, specifieke zaken)</li></ol><p style="margin-bottom:15px; font-style:italic; font-size:12px;">Let op dat alle persoonlijke informatie vertrouwelijk wordt behandeld (AVG).</p><h5 style="margin-bottom:5px; font-size:13px; color:var(--blue);">Communicatie</h5><p style="margin-bottom:5px;">Bij een groot evenement verloopt de communicatie via de coördinator en centralist. Anders via de Postcoördinator (PCO):</p><ol style="padding-left:20px; margin-bottom:15px;"><li><strong>Coördinator:</strong> Algemene leiding en besluitvorming.</li><li><strong>Centralist:</strong> Beheert communicatie en coördinatie tussen teams.</li><li><strong>PCO:</strong> Operationele aansturing op locatie.</li></ol><h5 style="margin-bottom:5px; font-size:13px; color:var(--blue);">Uit te voeren acties in overleg</h5><ol style="padding-left:20px; margin-bottom:15px;"><li><strong>Deel gegevens met organisatie:</strong> Met inachtneming van AVG.</li><li><strong>Controleer zorgrapportage:</strong> Kijk of de persoon recent is gezien.</li><li><strong>Informeer uitrukteams:</strong> Vraag uit te kijken naar de persoon, zonder dat dit primaire taken belemmert (geen actieve zoektocht).</li></ol><h5 style="margin-bottom:5px; font-size:13px; color:var(--blue);">Verslaglegging & Ondersteuning</h5><ul style="padding-left:20px; margin-bottom:15px;"><li>Rapporteer incidenten zo snel mogelijk via info@ems.nl.</li><li>Bij medische hulp: Maak zorgcontact aan volgens protocol.</li><li>Toon empathie, bied luisterend oor, geef geen valse verwachtingen en verwijs naar organisatie.</li></ul>` },
      ingrijpend: { titel: 'Ingrijpende Gebeurtenis', inhoud: `<h4 style="margin-bottom:10px; color:var(--text1);">Protocol bij Ingrijpende Gebeurtenissen (Versie 1, Mei 2024)</h4><p style="margin-bottom:15px;">Dit protocol treedt in werking bij een gebeurtenis die een grote emotionele of psychologische impact kan hebben op betrokkenen, getuigen of hulpverleners (bijv. ernstig ongeval, overlijden, grootschalig geweld).</p><h5 style="margin-bottom:5px; font-size:13px; color:var(--blue);">Fase 1: Directe Acties op Locatie</h5><ol style="padding-left:20px; margin-bottom:15px;"><li><strong>Veiligheid eerst:</strong> Zorg dat de locatie veilig is voor slachtoffers en hulpverleners.</li><li><strong>Alarmeer:</strong> Informeer direct de Coördinator/Centralist over de aard en omvang van de gebeurtenis.</li><li><strong>Scherm af:</strong> Creëer een veilige, afgeschermde ruimte voor direct betrokkenen. Voorkom blootstelling aan media of publiek.</li><li><strong>Verleen Eerste Hulp:</strong> Fysieke zorg heeft prioriteit. Behandel gewonden volgens standaard protocollen.</li></ol><h5 style="margin-bottom:5px; font-size:13px; color:var(--blue);">Fase 2: Opvang en Ondersteuning</h5><ol style="padding-left:20px; margin-bottom:15px;"><li><strong>Psychologische Eerste Hulp (PEH):</strong> Bied een luisterend oor. Wees empathisch, maar blijf professioneel. Forceer mensen niet om te praten.</li><li><strong>Bied praktische hulp:</strong> Zorg voor water, een deken, of de mogelijkheid om contact op te nemen met familie.</li><li><strong>Informeer:</strong> Geef duidelijke, feitelijke informatie over wat er gebeurt. Vermijd speculatie.</li><li><strong>Identificeer risicogevallen:</strong> Let op personen die extreem reageren (paniek, apathie) en geef hen extra aandacht. Overweeg professionele hulp (bijv. Slachtofferhulp).</li></ol><h5 style="margin-bottom:5px; font-size:13px; color:var(--blue);">Fase 3: Nazorg en Debriefing</h5><ul style="padding-left:20px; margin-bottom:15px;"><li><strong>Overdracht:</strong> Zorg voor een warme overdracht aan politie, Slachtofferhulp of andere instanties.</li><li><strong>Teamzorg:</strong> Organiseer een debriefing voor de betrokken hulpverleners. Bespreek de gebeurtenis, de emoties en de verleende zorg.</li><li><strong>Rapportage:</strong> Leg de gebeurtenis, de betrokkenen en de genomen acties zorgvuldig vast in het logboek.</li></ul>` }
  };

  document.getElementById('btnProtocols')?.addEventListener('click', () => {
      document.getElementById('protocolListModal').classList.add('show');
  });

      const closeProtocolListBtn = document.getElementById('closeProtocolListModalBtn');
      if (closeProtocolListBtn) {
          closeProtocolListBtn.addEventListener('click', () => {
              document.getElementById('protocolListModal').classList.remove('show');
      });
  }

  document.querySelectorAll('.protocol-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
          const protId = btn.getAttribute('data-protocol');
          const data = protocols[protId];
          if (data) {
              document.getElementById('protocolViewTitle').textContent = data.titel;
              document.getElementById('protocolViewContent').innerHTML = data.inhoud;
              document.getElementById('protocolViewFooter').style.display = protId === 'vermissing' ? 'block' : 'none';
              document.getElementById('protocolListModal').classList.remove('show');
              document.getElementById('protocolViewModal').classList.add('show');
          }
      });
  });

  const closeProtocolViewBtn = document.getElementById('closeProtocolViewModalBtn');
  if (closeProtocolViewBtn) {
      closeProtocolViewBtn.addEventListener('click', () => {
          document.getElementById('protocolViewModal').classList.remove('show');
      });
  }

  // ==========================================
  // VERMISSING PROCEDURE -> MELDING AANMAKEN
  // ==========================================
  const vermissingModal = document.getElementById('vermissingModal');
  const vermissingForm = document.getElementById('vermissingForm');

  document.getElementById('startVermissingProcBtn')?.addEventListener('click', () => {
      document.getElementById('protocolViewModal').classList.remove('show');
      vermissingModal.classList.add('show');
  });

  document.getElementById('closeVermissingModalBtn')?.addEventListener('click', () => {
      vermissingModal.classList.remove('show');
      vermissingForm.reset();
  });
  document.getElementById('cancelVermissingModalBtn')?.addEventListener('click', () => {
      vermissingModal.classList.remove('show');
      vermissingForm.reset();
  });

  if (vermissingForm) {
      vermissingForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const formData = new FormData(vermissingForm);
          const nu = new Date();
          const tijdString = nu.getHours().toString().padStart(2, '0') + ":" + nu.getMinutes().toString().padStart(2, '0');

          const newIncident = {
              id: "M-" + Date.now() + "-" + Math.floor(Math.random() * 999),
              status: 'Nieuw',
              time: tijdString,
              location: formData.get('location'),
              event: 'Vermissing',
              reporter: formData.get('reporter'),
              urgency: 'Normaal',
              units: [],
              details: {
                  naam: formData.get('naam'),
                  kenmerken: formData.get('kenmerken'),
                  situatie: formData.get('situatie'),
                  foto: formData.get('foto')
              },
              auditTrail: []
          };

          incidents.push(newIncident);
          addIncidentAudit(newIncident, 'Aangemaakt via protocol Vermissing');
          setDoc(doc(db, "incidents", newIncident.id), newIncident);

          renderTables(); renderUnits();
          if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();

          vermissingModal.classList.remove('show');
          vermissingForm.reset();
          showToast('Melding "Vermissing" succesvol aangemaakt.');
      });
  }

  // Offline / Online detectie
  window.addEventListener('offline', () => {
      document.getElementById('offlineBanner').style.display = 'block';
      const dot = document.getElementById('connectionDot');
      const text = document.getElementById('connectionText');
      if (dot && text) {
          dot.style.background = 'var(--amber)';
          dot.style.boxShadow = '0 0 8px var(--amber)';
          text.style.color = 'var(--amber)';
          text.textContent = 'Offline';
      }
  });
  window.addEventListener('online', () => {
      document.getElementById('offlineBanner').style.display = 'none';
      const dot = document.getElementById('connectionDot');
      const text = document.getElementById('connectionText');
      if (dot && text) {
          dot.style.background = 'var(--green)';
          dot.style.boxShadow = '0 0 8px var(--green)';
          text.style.color = 'var(--green)';
          text.textContent = 'Live';
      }
      showToast('Verbinding hersteld, data is gesynchroniseerd.');
  });

  // Sneltoetsen (Keyboard Shortcuts)
  // Sneltoetsen (Keyboard Shortcuts & Navigatie)
  document.addEventListener('keydown', (e) => {
      if (e.altKey) {
          if (e.key.toLowerCase() === 'n') {
              e.preventDefault();
              document.getElementById('btnQuickMedical').click();
          } else if (e.key.toLowerCase() === 's') {
              e.preventDefault();
              document.getElementById('btnDetailedMedical').click();
          } else if (e.key.toLowerCase() === 'b') {
              e.preventDefault();
              document.getElementById('btnBrandwacht').click();
          } else if (e.key.toLowerCase() === 'l') {
              e.preventDefault();
              document.getElementById('btnLogistiek').click();
          }
      }

      // Escape toets om actieve modal te sluiten
      if (e.key === 'Escape') {
          // Sluit urgentie dropdown
          if (urgencyDropdown && urgencyDropdown.classList.contains('open')) {
              closeUrgencyDropdown();
              return;
          }
          // Sluit toewijzen dropdown
          if (assignDropdown && assignDropdown.classList.contains('open')) {
              closeAssignDropdown();
              return;
          }
          // Sluit display-gebaseerde inline panelen
          const displayPanels = [
              document.getElementById('quickMedicalInlineContainer'),
              document.getElementById('detailedMedicalInlineContainer'),
          ];
          for (const panel of displayPanels) {
              if (panel && panel.style.display !== 'none') {
                  panel.style.display = 'none';
                  panel.querySelector('form')?.reset();
                  return;
              }
          }
          // Sluit class-gebaseerde inline panelen (brandwacht, logistiek, vrij logboek)
          const classPanel = document.querySelector('.inline-form-panel.show');
          if (classPanel) {
              classPanel.classList.remove('show');
              classPanel.querySelector('form')?.reset();
              return;
          }
          // Sluit modal overlays (opschalen, urgentie, toewijzen, afloop, tijdlijn, etc.)
          const openModal = document.querySelector('.modal-overlay.show');
          if (openModal) {
              const closeBtn = openModal.querySelector('.modal-close, .closeModalBtn');
              if (closeBtn) closeBtn.click();
              else openModal.classList.remove('show');
              return;
          }
      }

      // Enter om formulieren op te slaan
      // Enter om formulieren op te slaan (behalve in tekstvelden)
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
          const activeForm = e.target.closest('form');
          if (activeForm) {
              const parentModal = activeForm.closest('.modal-overlay.show');
              const parentSection = activeForm.closest('#unitFormSection, #postFormSection, #bulkUnitFormSection');

              if (parentModal || (parentSection && parentSection.style.display !== 'none')) {
                  e.preventDefault();
                  const submitBtn = activeForm.querySelector('.btn-submit');
                  if (submitBtn) {
                      submitBtn.click();
                  }
                  return; // Stop verdere verwerking
              }
          }
      }

      // Negeer pijltjestoetsen als je in een input typt of als er een modal open staat
      if (document.querySelector('.modal-overlay.show') || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          
          const activeView = document.querySelector('.view.active');
          if (!activeView) return;
          
          const tables = activeView.querySelectorAll('tbody');
          let allRows = [];
          tables.forEach(tbody => {
              const rows = Array.from(tbody.querySelectorAll('tr:not(.empty-table-msg)'));
              allRows = allRows.concat(rows);
          });

          if (allRows.length === 0) return;

          const currentSelected = activeView.querySelector('.selected-row');
          let selectedIndex = currentSelected ? allRows.indexOf(currentSelected) : -1;

          if (currentSelected) currentSelected.classList.remove('selected-row');

          if (e.key === 'ArrowDown') {
              selectedIndex = (selectedIndex + 1) % allRows.length;
          } else if (e.key === 'ArrowUp') {
              selectedIndex = (selectedIndex - 1 + allRows.length) % allRows.length;
          }

          const newSelected = allRows[selectedIndex];
          if (newSelected) {
              newSelected.classList.add('selected-row');
              newSelected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
      }
  });

  // Roep de functie aan die de temperatuur in de weer-knop laadt
  initializeWeather();
  setInterval(initializeWeather, 15 * 60 * 1000); // Ververs weer elke 15 minuten
          // ==========================================
          // SNELLE MEDISCHE MELDING (INLINE)
          // ==========================================
         const quickMedicalContainer = document.getElementById('quickMedicalInlineContainer');
          const quickMedicalForm = document.getElementById('quickMedicalForm');

          // 1. Knop opent inline formulier
          document.getElementById('btnQuickMedical')?.addEventListener('click', () => {
              const isOpen = quickMedicalContainer.style.display !== 'none';
              if (!isOpen) window.closeOtherInlinePanels('quickMedicalInlineContainer');
              quickMedicalContainer.style.display = isOpen ? 'none' : 'block';
              if (!isOpen) {
                  quickMedicalContainer.querySelector('input[name="reporter"]')?.focus();
              }
          });

          // 2. Sluit knoppen
          document.getElementById('closeQuickMedicalInlineBtn')?.addEventListener('click', () => {
              quickMedicalContainer.style.display = 'none';
              quickMedicalForm?.reset();
          });
          document.getElementById('cancelQuickMedicalInlineBtn')?.addEventListener('click', () => {
              quickMedicalContainer.style.display = 'none';
              quickMedicalForm?.reset();
          });

          // Wissel van snelle naar uitgebreide melding
          document.getElementById('openDetailedFromQuickBtn')?.addEventListener('click', () => {
              window.closeOtherInlinePanels('detailedMedicalInlineContainer');
              const dc = document.getElementById('detailedMedicalInlineContainer');
              if (dc) { dc.style.display = 'block'; dc.querySelector('input[name="reporter"]')?.focus(); }
          });

          // 3. Formulier verwerken
          if (quickMedicalForm) {
              quickMedicalForm.addEventListener('submit', (e) => {
                  e.preventDefault();
                  try {
                      const formData = new FormData(quickMedicalForm);
                      const melder = formData.get('reporter').toLowerCase().trim();
                      
                      let assignedUnit = "-";
                      let alertMsg = "Snelle medische melding succesvol aangemaakt.";

                      if (melder.startsWith('u') && melder.length > 1 && !isNaN(melder.substring(1))) {
                          const uNum = melder.substring(1).padStart(2, '0');
                          const unitToUpdate = units.find(u => u.id === `BLS-${uNum}` || u.id === `ALS-${uNum}`);
                          if (unitToUpdate) {
                              assignedUnit = unitToUpdate.id;
                              unitToUpdate.status = "uitgerukt";
                              unitToUpdate.location = formData.get('location');
                              setDoc(doc(db, "units", unitToUpdate.id), unitToUpdate);
                              alertMsg = `Melding aangemaakt. Eenheid '${assignedUnit}' is herkend en de status is automatisch gezet op 'uitgerukt'.`;
                          }
                      }

                      const nu = new Date();
                      const tijdString = nu.getHours().toString().padStart(2, '0') + ":" + nu.getMinutes().toString().padStart(2, '0');

                      const newIncident = {
                          id: "M-" + Date.now() + "-" + Math.floor(Math.random() * 999),
                          status: assignedUnit !== '-' ? 'Toegewezen' : 'Nieuw',
                          time: tijdString,
                          location: formData.get('location'),
                          event: formData.get('description'),
                          reporter: formData.get('reporter'),
                          urgency: formData.get('urgency'),
                          units: assignedUnit !== '-' ? [assignedUnit] : [],
                          details: { gender: formData.get('gender') },
                          auditTrail: []
                      };

                      incidents.push(newIncident);
                      addIncidentAudit(newIncident, `Aangemaakt - ${formData.get('urgency')}`);
                      setDoc(doc(db, "incidents", newIncident.id), newIncident);

                      renderTables(); renderUnits(); if (typeof renderDetailedUnitsTable === 'function') renderDetailedUnitsTable();
                      showToast(alertMsg);
                  } catch (err) {
                      console.error("Fout bij opslaan van de melding:", err);
                      showToast('Er ging iets mis bij het aanmaken van de melding.', true);
                  } finally {
                      quickMedicalContainer.style.display = 'none';
                      quickMedicalForm.reset();
                  }
              });
          }
